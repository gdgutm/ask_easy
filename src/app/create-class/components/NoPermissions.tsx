import footer from "../../components/footer";
import { User, getInitials, isLikelyAvatarImageUrl } from "@/utils/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NoPermissions({ user }: { user: User }) {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans text-stone-800 relative">
      <div className="absolute top-6 left-7 z-10">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 py-2.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-600 dark:bg-accent dark:hover:bg-accent/80 dark:text-accent-foreground rounded-md transition-colors font-medium text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>
      <div className="absolute top-6 right-7 z-10 flex items-center gap-3">
        <Avatar className="h-10 w-10 shadow-sm border-2 border-stone-100">
          {isLikelyAvatarImageUrl(user.pfp) && <AvatarImage src={user.pfp} alt={user.username} />}
          <AvatarFallback className="bg-white font-medium text-lg text-stone-900 tracking-tighter">
            {getInitials(user.username)}
          </AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-grow flex items-center justify-center pt-32 pb-12 px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-stone-900 tracking-wide uppercase">
            Access Denied
          </h1>
          <p className="text-stone-600">
            You do not have the Authorization to access the page. Contact support if the error is
            unintended.
          </p>
        </div>
      </div>
      {footer()}
    </div>
  );
}
