import "./style.css";
import { Experience } from "./experience/Experience";

try {
  new Experience();
} catch (error) {
  console.error("Element Bender could not open the world:", error);
  const status = document.getElementById("loading-status");
  if (status) {
    status.textContent =
      "The world could not open. Enable hardware acceleration in your browser, then reload.";
    const button = document.createElement("button");
    button.textContent = "Try again";
    button.className = "primary-button";
    button.addEventListener("click", () => location.reload());
    status.after(button);
  }
}
