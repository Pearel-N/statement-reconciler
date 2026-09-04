import { redirect } from "next/navigation";

import { createWorkspaceId } from "@/lib/workspace";

/**
 * Landing is not a page, it is a door.
 *
 * There is no login. Arriving at the root mints a workspace and puts its ID
 * in the URL, which from that point on is the only key to it. Rendering a
 * "create a workspace" button first would be a click that asks the user to
 * confirm something they have no basis to decide.
 *
 * `force-dynamic` because a cached redirect would hand every visitor the same
 * workspace — the one failure mode of this approach that actually matters.
 */
export const dynamic = "force-dynamic";

export default function RootPage() {
  redirect(`/w/${createWorkspaceId()}`);
}
