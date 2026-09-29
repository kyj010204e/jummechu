import { NextRequest } from "next/server";

import {
  completeOAuth,
} from "@/lib/oauth";


export async function GET(
  request: NextRequest
) {
  return completeOAuth(
    request,
    "naver"
  );
}
