import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Clearing all tables...\n");

  await prisma.answerUpvote.deleteMany();
  await prisma.questionUpvote.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.question.deleteMany();
  await prisma.slideSet.deleteMany();
  await prisma.session.deleteMany();
  await prisma.courseEnrollment.deleteMany();
  await prisma.course.deleteMany();
  await prisma.classlist.deleteMany();
  await prisma.user.deleteMany();

  console.log("✅ All tables cleared. DB is empty and ready.\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
