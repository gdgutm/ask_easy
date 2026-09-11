-- Course.name becomes the room's own label instead of a copy of the class code.
--
-- Until now a room was labelled by deriving its professor's surname at read
-- time, which meant the label changed under the admin whenever that person's
-- account name changed. The label is now stored and admin-owned.
--
-- Backfill with what the derivation used to produce: the last whitespace-
-- separated part of the professor's name, falling back to their UTORid.
-- Rooms with no professor keep the class code they already had.
UPDATE "Course" c
SET "name" = COALESCE(
    NULLIF(regexp_replace(btrim(u."name"), '^.*\s', ''), ''),
    u."utorid"
)
FROM "User" u
WHERE c."professorId" = u."id";
