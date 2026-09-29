import { NextRequest } from "next/server";

import {
  beginOAuth,
} from "@/lib/oauth";


export async function GET(
  request: NextRequest
) {
  return beginOAuth(
    request,
    "naver"
  );
}
