import { ApiInputError } from "./http";
import { getStateRepository } from "./repositories/state";

export async function recordRateLimitedAction(
  eventType: string,
  maximum: number,
  windowMilliseconds: number,
  message: string,
) {
  const state = getStateRepository();
  const threshold = Date.now() - windowMilliseconds;
  const events = await state.listActivity(100);
  const count = events.filter(
    (event) => event.eventType === eventType && event.createdAt.getTime() >= threshold,
  ).length;
  if (count >= maximum) {
    throw new ApiInputError("This action has reached its temporary safety limit.", "RATE_LIMITED", 429);
  }
  await state.logActivity({ eventType, status: "info", message });
}
