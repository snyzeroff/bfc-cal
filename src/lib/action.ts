import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError, type ActionResult } from "./errors";

/** Runs a mutation and converts failures into a serialisable result for the client. */
export async function run<T>(fn: () => Promise<T>, opts: { revalidate?: boolean } = {}): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (opts.revalidate !== false) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof AppError) return { ok: false, code: err.code, error: err.message, details: err.details };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, code: "invalid", error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input." };
    }
    console.error("[action]", err);
    return { ok: false, code: "error", error: "Something went wrong on our side. Nothing was saved — please try again." };
  }
}
