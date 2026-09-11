-- hasLoggedIn existed only to decide whether a name an admin typed was a
-- placeholder. Room names are now the room's own, set by an admin and never
-- rewritten, so nothing branches on whether someone has signed in before.
ALTER TABLE "User" DROP COLUMN "hasLoggedIn";
