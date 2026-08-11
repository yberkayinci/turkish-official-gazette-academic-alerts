const cronProfile = process.env.VERCEL_CRON_PROFILE === "pro" ? "pro" : "hobby";

/**
 * Hobby accepts only one native Cron invocation per day. Pro invokes the same
 * protected route hourly; application settings then gate the selected interval
 * and Europe/Istanbul active window.
 */
export const config = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  fluid: true,
  regions: ["fra1"],
  crons: [
    {
      path: "/api/cron/monitor",
      // Hobby checks daily at 10:17 Europe/Istanbul. Pro checks hourly at
      // minute 17, then the application enforces the saved interval/window.
      schedule: cronProfile === "pro" ? "17 * * * *" : "17 7 * * *",
    },
  ],
};
