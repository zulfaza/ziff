import type { ZiffApi } from "./shared";

declare global {
  interface Window {
    ziff: ZiffApi;
  }
}
