import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const WALLET_PATTERNS = [
  "MetaMask",
  "StacksProvider",
  "Cannot redefine property",
  "Failed to connect",
  "ethereum",
  "web3",
  "chrome-extension://",
];

function isWalletError(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return WALLET_PATTERNS.some((pattern) =>
    normalizedMessage.includes(pattern.toLowerCase()),
  );
}

window.addEventListener(
  "error",
  (event) => {
    if (event.message && isWalletError(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true,
);

window.addEventListener("unhandledrejection", (event) => {
  const reason =
    event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");

  if (isWalletError(reason)) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (isWalletError(args.map(String).join(" "))) {
    return;
  }

  originalError(...args);
};

createRoot(document.getElementById("root")!).render(<App />);
