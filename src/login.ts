// The OAuth device login: show a code, the user approves it on
// bookfusion.com/device, and the token lands in the credentials file. The
// MCP tool starts it and returns at once (tool calls time out long before a
// person finishes); polling continues in the background.

import { BookFusion, DeviceCode } from "./client.js";
import { saveCredentials } from "./config.js";

export type LoginState =
  | { kind: "idle" }
  | { kind: "waiting"; code: DeviceCode; expiresAt: number }
  | { kind: "done"; at: number }
  | { kind: "failed"; reason: string };

export class DeviceLogin {
  state: LoginState = { kind: "idle" };
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly client: () => BookFusion,
    private readonly onToken: (token: string) => void,
    private readonly sleep = (ms: number) => new Promise<void>((r) => (this.timer = setTimeout(r, ms))),
  ) {}

  /** Starts a login (or returns the one in progress) without waiting for it. */
  async start(): Promise<DeviceCode> {
    if (this.state.kind === "waiting" && Date.now() < this.state.expiresAt) return this.state.code;
    const code = await this.client().startDeviceLogin();
    const expiresAt = Date.now() + (code.expires_in > 0 ? code.expires_in : 600) * 1000;
    this.state = { kind: "waiting", code, expiresAt };
    void this.poll(code, expiresAt);
    return code;
  }

  /** Polls until approved, denied or expired; resolves with the outcome. */
  async poll(code: DeviceCode, expiresAt: number): Promise<LoginState> {
    let interval = (code.interval > 0 ? code.interval : 5) * 1000;
    while (Date.now() < expiresAt) {
      await this.sleep(interval);
      if (this.state.kind !== "waiting" || this.state.code.device_code !== code.device_code) return this.state;
      const r = await this.client().pollDeviceLogin(code.device_code).catch((e) => ({ failed: String(e?.message ?? e) }) as const);
      if ("token" in r) {
        saveCredentials({ token: r.token });
        this.onToken(r.token);
        return (this.state = { kind: "done", at: Date.now() });
      }
      if ("pending" in r) {
        if (r.pending === "slow_down") interval += 5000;
        continue;
      }
      // Network hiccups keep polling; a refusal ends it.
      if (["access_denied", "expired_token", "invalid_grant", "invalid_client"].includes(r.failed)) return (this.state = { kind: "failed", reason: r.failed });
    }
    return (this.state = { kind: "failed", reason: "expired_token" });
  }

  stop() {
    clearTimeout(this.timer);
  }
}

export function describeLoginFailure(reason: string): string {
  if (reason === "access_denied") return "The login was denied on bookfusion.com.";
  if (reason === "expired_token") return "The login code expired before it was approved. Start again.";
  if (reason === "invalid_client") return "BookFusion no longer accepts this client id (BOOKFUSION_CLIENT_ID).";
  return `Login failed: ${reason}`;
}
