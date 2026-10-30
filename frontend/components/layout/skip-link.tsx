"use client";

/** First focusable element on every page: jumps keyboard users past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      // Move focus explicitly: client-side routing doesn't always honour the fragment.
      onClick={(e) => {
        const main = document.getElementById("main");
        if (!main) return;
        e.preventDefault();
        main.focus();
        main.scrollIntoView();
      }}
      className="sr-only z-[100] rounded-md bg-background px-4 py-2 text-sm font-medium shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >
      Skip to main content
    </a>
  );
}
