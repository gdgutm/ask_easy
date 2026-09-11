export interface OnboardingStep {
  title: string;
  description: string[];
  /** Optional hero image under `public/` (e.g. `/images/onboarding/foo.svg`). */
  image?: string;
  altText: string;
}

export const STUDENT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Welcome to AskEasy",
    description: [
      "Post a question and get answered in real-time during lectures.",
      "TAs reply directly, so you get answers without disrupting the lecture.",
    ],
    image: "/images/onboarding/question.png",
    altText: "Live Q&A feed with questions and replies",
  },
  {
    title: "Upvote Questions",
    description: [
      "The most upvoted unresolved questions rise to the top.",
      "Everyone can mark their own question as resolved.",
      "Only TAs and professors can mark other people's questions as resolved.",
    ],
    image: "/images/onboarding/upvote-rank.png",
    altText: "Questions ranked by upvotes with resolution filters",
  },
  {
    title: "Stay Anonymous",
    description: [
      "Toggle Anonymous Mode to hide your name.",
      "TAs and professors can still find you if misused.",
    ],
    image: "/images/onboarding/anon.png",
    altText: "Anonymous mode toggle hiding your identity",
  },
];

export const PROF_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Go Live & Share Slides",
    description: [
      "Open your class, then hit 'Start Live Session' on your room. Students will see it go green on their home page.",
      "Upload your lecture slides as a PDF and students will see them in a synced split-view alongside the chat.",
    ],
    image: "/images/onboarding/onboard-classes.jpg",
    altText: "Starting a live session with slides and chat",
  },
  {
    title: "Engage With Your Class",
    description: [
      "Students post and upvote questions in real time. The most pressing ones rise to the top.",
      "Reply in the chat or address questions verbally. You can also control whether only TAs can answer.",
    ],
    image: "/images/onboarding/onboard-engage.jpg",
    altText: "Professor replying to student questions in real time",
  },
  {
    title: "Manage & Export",
    description: [
      "Assign TAs, moderate posts, and control answer permissions from within the session. Every professor on a class runs their own room and sees only that one.",
      "When you end a session, download the full Q&A transcript as a .txt file.",
    ],
    image: "/images/onboarding/onboard-end.jpg",
    altText: "Session management tools and chat export",
  },
];
