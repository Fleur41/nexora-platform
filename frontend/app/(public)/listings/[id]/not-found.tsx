import { Home } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function ListingNotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6">
      <Home className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">This home is no longer advertised</h1>
      <p className="text-muted-foreground">It has been let, or the landlord has taken the advert down.</p>
      <Button asChild>
        <Link href="/listings">See other homes</Link>
      </Button>
    </div>
  );
}
