"use client";

import { Download, Share, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "nexora.installPromptDismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Offers to add the portal to the home screen. Chrome/Edge/Android fire beforeinstallprompt;
 * iOS Safari never does, so iPhone users get the Share → Add to Home Screen instructions.
 */
export function InstallPrompt() {
  const [event, setEvent] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = React.useState(false);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed || isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Defer the state update so it doesn't happen synchronously inside the effect.
    const timer = window.setTimeout(() => {
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        setIos(true);
        setHidden(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!event && !ios)) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Ignore: it simply shows again next visit.
    }
    setHidden(true);
  };

  return (
    <div role="region" aria-label="Install the app" className="mb-5 flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="rounded-lg bg-accent/15 p-2"><Download className="size-5 text-accent-strong" aria-hidden /></div>
      <div className="flex-1 text-sm">
        <p className="font-medium">Get the Nexora app</p>
        {ios ? (
          <p className="text-muted-foreground">
            Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then <strong>Add to Home Screen</strong> to open your bills and repairs like an app.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">Install it on your phone to check bills, pay rent and report repairs in one tap.</p>
            <Button size="sm" className="mt-2"
              onClick={async () => {
                await event!.prompt();
                const choice = await event!.userChoice;
                if (choice.outcome === "accepted") setHidden(true);
              }}>
              Install app
            </Button>
          </>
        )}
      </div>
      <button type="button" onClick={dismiss} className="rounded p-1 text-muted-foreground hover:text-foreground">
        <X className="size-4" />
        <span className="sr-only">Dismiss</span>
      </button>
    </div>
  );
}

/** Registers the portal service worker (offline page). Production only: dev reloads constantly. */
export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/portal-sw.js", { scope: "/portal", updateViaCache: "none" }).catch(() => {
      // Not fatal: the portal works without it, just not offline.
    });
  }, []);
  return null;
}
