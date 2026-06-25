import { createRoot } from "react-dom/client";
import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import App from "./App.tsx";
import "./index.css";

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY || '6LelpzMtAAAAAAAfuUs-EM7dCRf0x1sOkuLzZgTi';

createRoot(document.getElementById("root")!).render(
  <GoogleReCaptchaProvider reCaptchaKey={RECAPTCHA_SITE_KEY}>
    <App />
  </GoogleReCaptchaProvider>
);
