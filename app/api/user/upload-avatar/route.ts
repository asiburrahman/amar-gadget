import { NextResponse } from "next/server";
import { avatarActor, avatarFailure, avatarPrivateHeaders, readAvatarRemoval, readAvatarUpload } from "@/lib/avatar-request";
import { normalizeAvatarImage, withAvatarUploadSlot } from "@/lib/avatar-image";
import { publishOwnedAvatar, readOwnedAvatar, removeOwnedAvatar, restoreLegacyAvatar } from "@/lib/avatars";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  try { return NextResponse.json({ success: true, photo: await readOwnedAvatar(await avatarActor(request)) }, { headers: avatarPrivateHeaders }); }
  catch (error) { return avatarFailure(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await avatarActor(request, true);
    return await withAvatarUploadSlot(async () => {
      const input = await readAvatarUpload(request);
      const photo = input.source ? await publishOwnedAvatar(actor, input.avatarVersion, await normalizeAvatarImage(input.source.bytes, input.source.type)) : await restoreLegacyAvatar(actor, input.avatarVersion);
      return NextResponse.json({ success: true, photo, message: "Profile photo saved." }, { headers: avatarPrivateHeaders });
    });
  } catch (error) { return avatarFailure(error); }
}
export async function DELETE(request: Request) {
  try {
    const actor = await avatarActor(request, true);
    const photo = await removeOwnedAvatar(actor, await readAvatarRemoval(request));
    return NextResponse.json({ success: true, photo, message: "Profile photo removed." }, { headers: avatarPrivateHeaders });
  } catch (error) { return avatarFailure(error); }
}
