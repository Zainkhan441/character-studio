/**
 * /poses — merged into /creator (ChatGPT audit, 2026-11-05).
 *
 * The pose matrix (all 21 poses of the same character) now lives as
 * the poses strip at the bottom of the Creator canvas. This route
 * redirects there so old links keep working.
 */
import { redirect } from "next/navigation";

export default function PosesPage() {
  redirect("/creator");
}
