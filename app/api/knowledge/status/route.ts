import { NextResponse } from "next/server";
import manifest from "../../../../data/knowledge/manifest-v2.json";

export async function GET() {
  return NextResponse.json(manifest);
}
