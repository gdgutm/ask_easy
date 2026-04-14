import { redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/adminWhitelist";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.utorid)) {
    redirect("/");
  }

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <header className="border-b bg-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-stone-400 hover:text-stone-600 text-sm transition-colors">
            &larr; Back
          </Link>
          <h1 className="text-lg font-semibold text-stone-900">Admin Dashboard</h1>
        </div>
        <span className="text-sm text-stone-500">
          {user.name} ({user.utorid})
        </span>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
