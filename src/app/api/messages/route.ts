import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mutationSchema, plainText } from "@/lib/model";
import { authenticated, adminClient, apiError, ApiError, boundedJson } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    const context = await authenticated(request);
    const parsed = mutationSchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message ?? "Invalid message.");
    const mutation = parsed.data;
    const searchText = [mutation.title, plainText(mutation.body), ...mutation.attachments.map((a) => a.name)].join("\n");
    const { data, error } = await adminClient().rpc("save_message", {
      p_user_id: context.user.id, p_mutation: mutation, p_search_text: searchText,
      p_hash: createHash("sha256").update(JSON.stringify(mutation)).digest("hex"),
    });
    if (error) {
      if (error.code === "40001") throw new ApiError(409, "Edited on another device. Copy your changes or save as new.");
      if (error.code === "22023") throw new ApiError(400, "Attachments aren't ready or the request ID was reused.");
      throw new ApiError(503, "Message not saved. Check the database and retry.");
    }
    return context.apply(NextResponse.json(data));
  } catch (error) { return apiError(error); }
}
