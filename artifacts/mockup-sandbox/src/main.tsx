import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress wallet extension errors (MetaMask, Xverse, etc.)
// These extensions try to inject providers into window and may conflict with each other
const originalError = console.error;
const errorFilter = (error: any) => {
  if (
    error instanceof Error &&
    (error.message.includes("StacksProvider") ||
      error.message.includes("MetaMask") ||
      error.message.includes("Cannot redefine property") ||
      error.message.includes("Failed to connect"))
  ) {
    return; // Suppress wallet extension errors
  }
  originalError(error);
};
console.error = errorFilter;

// Suppress uncaught promise rejections from wallet extensions
window.addEventListener("unhandledrejection", (event) => {
  if (
    event.reason &&
    typeof event.reason === "object" &&
    "message" in event.reason &&
    (event.reason.message.includes("MetaMask") ||
      event.reason.message.includes("StacksProvider") ||
      event.reason.message.includes("Failed to connect"))
  ) {
    event.preventDefault(); // Suppress the error
  }
});

createRoot(document.getElementById("root")!).render(<App />);
