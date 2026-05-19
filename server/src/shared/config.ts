export const config = {
  rssFeeds: [
    "https://openai.com/blog/rss.xml",
    "https://deepmind.google/blog/rss.xml",
    "https://huggingface.co/blog/feed.xml",
  ],
  voices: {
    HOST_A: "af_bella",
    HOST_B: "am_michael",
  },
  targetBufferMinutes: 30,
  segmentWordTarget: 180,
  turnRange: { min: 8, max: 12 },
  dedupJaccardThreshold: 0.6,
  fingerprintRetentionDays: 7,
  gcGraceMinutes: 10,
  evergreenTopics: [
    "transformer architecture fundamentals",
    "history of neural networks",
    "the alignment problem",
    "scaling laws",
  ],
} as const;
