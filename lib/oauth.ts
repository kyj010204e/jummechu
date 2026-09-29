import {
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import bcrypt from "bcryptjs";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  prisma,
} from "@/lib/prisma";

import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";


export type OAuthProvider =
  | "google"
  | "naver"
  | "kakao";


type OAuthProfile = {
  providerUserId: string;

  email: string;

  name: string;

  profileImageUrl:
    string | null;
};


type OAuthAccountRow = {
  user_id: bigint;
};


type UserIdRow = {
  id: bigint;
};


type CountRow = {
  count: bigint;
};


const OAUTH_STATE_TTL_SECONDS =
  10 * 60;


function getStateCookieName(
  provider: OAuthProvider
) {
  return `jummechu_oauth_state_${provider}`;
}


function getProviderLabel(
  provider: OAuthProvider
) {
  switch (provider) {
    case "google":
      return "Google";

    case "naver":
      return "네이버";

    case "kakao":
      return "카카오";
  }
}


function requireEnv(
  name: string
) {
  const value =
    process.env[name]
      ?.trim();

  if (!value) {
    throw new Error(
      `${name} 환경변수가 설정되지 않았습니다.`
    );
  }

  return value;
}


function getBaseUrl(
  request: NextRequest
) {
  const configured =
    process.env.OAUTH_BASE_URL
      ?.trim()
      .replace(
        /\/+$/,
        ""
      );

  if (configured) {
    return configured;
  }

  return request.nextUrl.origin;
}


function getRedirectUri(
  request: NextRequest,
  provider: OAuthProvider
) {
  return (
    `${getBaseUrl(request)}` +
    `/api/oauth/${provider}/callback`
  );
}


function makeState() {
  return randomBytes(32)
    .toString(
      "base64url"
    );
}


function safeEquals(
  left: string,
  right: string
) {
  const a =
    Buffer.from(
      left,
      "utf8"
    );

  const b =
    Buffer.from(
      right,
      "utf8"
    );

  if (
    a.length !==
    b.length
  ) {
    return false;
  }

  return timingSafeEqual(
    a,
    b
  );
}


function normalizeEmail(
  value:
    string |
    null |
    undefined
) {
  const email =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      email
    )
  ) {
    return "";
  }

  return email;
}


function normalizeName(
  value:
    string |
    null |
    undefined,

  email: string
) {
  const name =
    String(
      value ?? ""
    )
      .trim()
      .replace(
        /\s+/g,
        " "
      )
      .slice(
        0,
        100
      );

  if (name) {
    return name;
  }

  return (
    email
      .split("@")[0]
      ?.slice(
        0,
        100
      ) ||
    "점메추 사용자"
  );
}


function makeOAuthErrorUrl(
  request: NextRequest,
  message: string
) {
  const url =
    new URL(
      "/oauth-complete",
      getBaseUrl(
        request
      )
    );

  url.searchParams.set(
    "error",
    message
  );

  return url;
}


function makeOAuthSuccessUrl(
  request: NextRequest,
  nextPath:
    "/preferences" |
    "/map"
) {
  const url =
    new URL(
      "/oauth-complete",
      getBaseUrl(
        request
      )
    );

  url.searchParams.set(
    "next",
    nextPath
  );

  return url;
}


function clearStateCookie(
  response: NextResponse,
  provider: OAuthProvider
) {
  response.cookies.set(
    getStateCookieName(
      provider
    ),
    "",
    {
      httpOnly: true,

      secure:
        process.env.NODE_ENV ===
        "production",

      sameSite:
        "lax",

      path:
        "/",

      maxAge:
        0,
    }
  );
}


function makeAuthorizeUrl(
  request: NextRequest,
  provider: OAuthProvider,
  state: string
) {
  const redirectUri =
    getRedirectUri(
      request,
      provider
    );

  if (
    provider ===
    "google"
  ) {
    const url =
      new URL(
        "https://accounts.google.com/o/oauth2/v2/auth"
      );

    url.searchParams.set(
      "client_id",
      requireEnv(
        "GOOGLE_CLIENT_ID"
      )
    );

    url.searchParams.set(
      "redirect_uri",
      redirectUri
    );

    url.searchParams.set(
      "response_type",
      "code"
    );

    url.searchParams.set(
      "scope",
      "openid email profile"
    );

    url.searchParams.set(
      "state",
      state
    );

    url.searchParams.set(
      "include_granted_scopes",
      "true"
    );

    url.searchParams.set(
      "prompt",
      "select_account"
    );

    return url;
  }


  if (
    provider ===
    "naver"
  ) {
    const url =
      new URL(
        "https://nid.naver.com/oauth2.0/authorize"
      );

    url.searchParams.set(
      "client_id",
      requireEnv(
        "NAVER_CLIENT_ID"
      )
    );

    url.searchParams.set(
      "redirect_uri",
      redirectUri
    );

    url.searchParams.set(
      "response_type",
      "code"
    );

    url.searchParams.set(
      "state",
      state
    );

    return url;
  }


  const url =
    new URL(
      "https://kauth.kakao.com/oauth/authorize"
    );

  url.searchParams.set(
    "client_id",
    requireEnv(
      "KAKAO_REST_API_KEY"
    )
  );

  url.searchParams.set(
    "redirect_uri",
    redirectUri
  );

  url.searchParams.set(
    "response_type",
    "code"
  );

  url.searchParams.set(
    "state",
    state
  );

  /*
   * 카카오는 개발자 콘솔의 동의항목 설정을 사용합니다.
   * 이메일 / 닉네임을 콘솔에서 활성화해주세요.
   */

  return url;
}


async function fetchJson<T>(
  url: string,
  init?: RequestInit
) {
  const response =
    await fetch(
      url,
      {
        ...init,

        cache:
          "no-store",
      }
    );

  const data =
    (
      await response.json()
        .catch(
          () => null
        )
    ) as T | null;

  if (
    !response.ok ||
    !data
  ) {
    throw new Error(
      "소셜 로그인 제공자와 통신하지 못했습니다."
    );
  }

  return data;
}


async function exchangeAccessToken(
  request: NextRequest,
  provider: OAuthProvider,
  code: string,
  state: string
) {
  const redirectUri =
    getRedirectUri(
      request,
      provider
    );


  if (
    provider ===
    "google"
  ) {
    const body =
      new URLSearchParams({
        grant_type:
          "authorization_code",

        code,

        client_id:
          requireEnv(
            "GOOGLE_CLIENT_ID"
          ),

        client_secret:
          requireEnv(
            "GOOGLE_CLIENT_SECRET"
          ),

        redirect_uri:
          redirectUri,
      });


    const data =
      await fetchJson<{
        access_token?: string;
        error?: string;
      }>(
        "https://oauth2.googleapis.com/token",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body,
        }
      );


    if (
      !data.access_token
    ) {
      throw new Error(
        "Google 액세스 토큰을 받지 못했습니다."
      );
    }

    return data.access_token;
  }


  if (
    provider ===
    "naver"
  ) {
    const body =
      new URLSearchParams({
        grant_type:
          "authorization_code",

        client_id:
          requireEnv(
            "NAVER_CLIENT_ID"
          ),

        client_secret:
          requireEnv(
            "NAVER_CLIENT_SECRET"
          ),

        code,

        state,
      });


    const data =
      await fetchJson<{
        access_token?: string;
        error?: string;
        error_description?: string;
      }>(
        "https://nid.naver.com/oauth2.0/token",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body,
        }
      );


    if (
      !data.access_token
    ) {
      throw new Error(
        "네이버 액세스 토큰을 받지 못했습니다."
      );
    }

    return data.access_token;
  }


  const body =
    new URLSearchParams({
      grant_type:
        "authorization_code",

      client_id:
        requireEnv(
          "KAKAO_REST_API_KEY"
        ),

      redirect_uri:
        redirectUri,

      code,
    });


  const kakaoClientSecret =
    process.env
      .KAKAO_CLIENT_SECRET
      ?.trim();


  if (
    kakaoClientSecret
  ) {
    body.set(
      "client_secret",
      kakaoClientSecret
    );
  }


  const data =
    await fetchJson<{
      access_token?: string;
      error?: string;
      error_description?: string;
    }>(
      "https://kauth.kakao.com/oauth/token",
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded;charset=utf-8",
        },

        body,
      }
    );


  if (
    !data.access_token
  ) {
    throw new Error(
      "카카오 액세스 토큰을 받지 못했습니다."
    );
  }

  return data.access_token;
}


async function fetchOAuthProfile(
  provider: OAuthProvider,
  accessToken: string
): Promise<OAuthProfile> {

  if (
    provider ===
    "google"
  ) {
    const data =
      await fetchJson<{
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
        picture?: string;
      }>(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        }
      );


    const email =
      normalizeEmail(
        data.email
      );


    if (
      !data.sub ||
      !email ||
      data.email_verified ===
        false
    ) {
      throw new Error(
        "Google 계정의 확인된 이메일 정보를 가져올 수 없습니다."
      );
    }


    return {
      providerUserId:
        data.sub,

      email,

      name:
        normalizeName(
          data.name,
          email
        ),

      profileImageUrl:
        data.picture ??
        null,
    };
  }


  if (
    provider ===
    "naver"
  ) {
    const data =
      await fetchJson<{
        resultcode?: string;
        message?: string;

        response?: {
          id?: string;
          email?: string;
          name?: string;
          nickname?: string;
          profile_image?: string;
        };
      }>(
        "https://openapi.naver.com/v1/nid/me",
        {
          headers: {
            Authorization:
              `Bearer ${accessToken}`,
          },
        }
      );


    const profile =
      data.response;

    const email =
      normalizeEmail(
        profile?.email
      );


    if (
      data.resultcode !==
        "00" ||
      !profile?.id ||
      !email
    ) {
      throw new Error(
        "네이버 로그인에서 이메일 제공 동의가 필요합니다."
      );
    }


    return {
      providerUserId:
        profile.id,

      email,

      name:
        normalizeName(
          profile.name ||
          profile.nickname,
          email
        ),

      profileImageUrl:
        profile.profile_image ??
        null,
    };
  }


  const data =
    await fetchJson<{
      id?: number | string;

      kakao_account?: {
        email?: string;

        is_email_valid?: boolean;

        is_email_verified?: boolean;

        profile?: {
          nickname?: string;
          profile_image_url?: string;
        };
      };

      properties?: {
        nickname?: string;
        profile_image?: string;
      };
    }>(
      "https://kapi.kakao.com/v2/user/me",
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
        },
      }
    );


  const account =
    data.kakao_account;

  const email =
    normalizeEmail(
      account?.email
    );


  if (
    data.id ===
      undefined ||
    !email ||
    account?.is_email_valid ===
      false ||
    account?.is_email_verified ===
      false
  ) {
    throw new Error(
      "카카오 로그인에서 이메일 제공 동의가 필요합니다."
    );
  }


  return {
    providerUserId:
      String(
        data.id
      ),

    email,

    name:
      normalizeName(
        account
          ?.profile
          ?.nickname ||
        data.properties
          ?.nickname,
        email
      ),

    profileImageUrl:
      account
        ?.profile
        ?.profile_image_url ||
      data.properties
        ?.profile_image ||
      null,
  };
}


async function findOrCreateOAuthUser(
  provider: OAuthProvider,
  profile: OAuthProfile
) {
  /*
   * OAuth 전용 계정도 기존 users 테이블을 그대로 사용합니다.
   *
   * users.password_hash가 현재 NOT NULL이므로,
   * 사용자가 절대로 알 수 없는 임의 비밀번호 해시를 저장합니다.
   * 실제 로그인은 oauth_accounts 연결을 통해서만 이루어집니다.
   *
   * 추후 users.password_hash를 nullable로 바꾸고 싶다면
   * 이 임의 해시 생성 부분만 제거하면 됩니다.
   */
  const unreachablePassword =
    randomBytes(48)
      .toString(
        "base64url"
      );

  const passwordHash =
    await bcrypt.hash(
      unreachablePassword,
      12
    );


  return await prisma.$transaction(
    async (tx) => {
      const linked =
        await tx.$queryRaw<
          OAuthAccountRow[]
        >`
          SELECT
            user_id

          FROM oauth_accounts

          WHERE
            provider =
              ${provider}

            AND provider_user_id =
              ${profile.providerUserId}

          LIMIT 1
        `;


      if (
        linked[0]
      ) {
        await tx.$executeRaw`
          UPDATE oauth_accounts

          SET
            provider_email =
              ${profile.email},

            provider_name =
              ${profile.name},

            provider_profile_image_url =
              ${profile.profileImageUrl},

            last_login_at =
              CURRENT_TIMESTAMP,

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            provider =
              ${provider}

            AND provider_user_id =
              ${profile.providerUserId}
        `;

        return linked[0]
          .user_id;
      }


      /*
       * 같은 이메일의 기존 점메추 계정이 있으면
       * 새 users 행을 만들지 않고 해당 계정에 소셜 로그인을 연결합니다.
       */
      const existingUsers =
        await tx.$queryRaw<
          UserIdRow[]
        >`
          SELECT
            id

          FROM users

          WHERE
            LOWER(
              email
            ) =
            LOWER(
              ${profile.email}
            )

          LIMIT 1
        `;


      let userId =
        existingUsers[0]
          ?.id;


      if (
        !userId
      ) {
        const createdUsers =
          await tx.$queryRaw<
            UserIdRow[]
          >`
            INSERT INTO users
            (
              email,
              password_hash,
              name,
              profile_avatar_key,
              profile_image_url,
              created_at,
              email_verified_at
            )

            VALUES
            (
              ${profile.email},
              ${passwordHash},
              ${profile.name},
              'chef',
              NULL,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )

            RETURNING
              id
          `;


        userId =
          createdUsers[0]
            .id;
      }


      await tx.$executeRaw`
        INSERT INTO oauth_accounts
        (
          user_id,

          provider,
          provider_user_id,

          provider_email,
          provider_name,
          provider_profile_image_url,

          last_login_at,

          created_at,
          updated_at
        )

        VALUES
        (
          ${userId},

          ${provider},
          ${profile.providerUserId},

          ${profile.email},
          ${profile.name},
          ${profile.profileImageUrl},

          CURRENT_TIMESTAMP,

          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT
          (
            provider,
            provider_user_id
          )

        DO UPDATE SET
          provider_email =
            EXCLUDED.provider_email,

          provider_name =
            EXCLUDED.provider_name,

          provider_profile_image_url =
            EXCLUDED.provider_profile_image_url,

          last_login_at =
            CURRENT_TIMESTAMP,

          updated_at =
            CURRENT_TIMESTAMP
      `;


      const finalLinked =
        await tx.$queryRaw<
          OAuthAccountRow[]
        >`
          SELECT
            user_id

          FROM oauth_accounts

          WHERE
            provider =
              ${provider}

            AND provider_user_id =
              ${profile.providerUserId}

          LIMIT 1
        `;


      return (
        finalLinked[0]
          ?.user_id ??
        userId
      );
    }
  );
}


async function getNextPath(
  userId: bigint
): Promise<
  "/preferences" |
  "/map"
> {
  try {
    const rows =
      await prisma.$queryRaw<
        CountRow[]
      >`
        SELECT
          COUNT(*)::bigint
            AS count

        FROM user_food_preferences

        WHERE
          user_id =
            ${userId}
      `;


    return (
      Number(
        rows[0]
          ?.count ??
        0
      ) >=
      5
    )
      ? "/map"
      : "/preferences";

  } catch {
    /*
     * 상세 취향 테이블이 아직 없는 개발 환경에서는
     * 온보딩부터 시작합니다.
     */
    return "/preferences";
  }
}


export async function beginOAuth(
  request: NextRequest,
  provider: OAuthProvider
) {
  try {
    const state =
      makeState();

    const authorizeUrl =
      makeAuthorizeUrl(
        request,
        provider,
        state
      );


    const response =
      NextResponse.redirect(
        authorizeUrl
      );


    response.cookies.set(
      getStateCookieName(
        provider
      ),
      state,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite:
          "lax",

        path:
          "/",

        maxAge:
          OAUTH_STATE_TTL_SECONDS,
      }
    );


    return response;

  } catch (error) {
    console.error(
      `${getProviderLabel(provider)} OAuth start error:`,
      error
    );


    const message =
      error instanceof
        Error
        ? error.message
        : `${getProviderLabel(provider)} 로그인을 시작하지 못했습니다.`;


    return NextResponse.redirect(
      makeOAuthErrorUrl(
        request,
        message
      )
    );
  }
}


export async function completeOAuth(
  request: NextRequest,
  provider: OAuthProvider
) {
  try {
    const providerError =
      request.nextUrl
        .searchParams
        .get(
          "error"
        );


    if (
      providerError
    ) {
      throw new Error(
        `${getProviderLabel(provider)} 로그인이 취소되었거나 승인되지 않았습니다.`
      );
    }


    const code =
      request.nextUrl
        .searchParams
        .get(
          "code"
        )
        ?.trim();


    const state =
      request.nextUrl
        .searchParams
        .get(
          "state"
        )
        ?.trim();


    const savedState =
      request.cookies.get(
        getStateCookieName(
          provider
        )
      )?.value;


    if (
      !code ||
      !state ||
      !savedState ||
      !safeEquals(
        state,
        savedState
      )
    ) {
      throw new Error(
        "소셜 로그인 보안 검증에 실패했습니다. 다시 시도해주세요."
      );
    }


    const accessToken =
      await exchangeAccessToken(
        request,
        provider,
        code,
        state
      );


    const profile =
      await fetchOAuthProfile(
        provider,
        accessToken
      );


    const userId =
      await findOrCreateOAuthUser(
        provider,
        profile
      );


    const sessionToken =
      await createSessionToken(
        userId.toString()
      );


    const nextPath =
      await getNextPath(
        userId
      );


    const response =
      NextResponse.redirect(
        makeOAuthSuccessUrl(
          request,
          nextPath
        )
      );


    response.cookies.set(
      SESSION_COOKIE_NAME,
      sessionToken,
      {
        httpOnly: true,

        secure:
          process.env.NODE_ENV ===
          "production",

        sameSite:
          "lax",

        path:
          "/",

        maxAge:
          SESSION_DURATION,
      }
    );


    clearStateCookie(
      response,
      provider
    );


    return response;

  } catch (error) {
    console.error(
      `${getProviderLabel(provider)} OAuth callback error:`,
      error
    );


    const message =
      error instanceof
        Error
        ? error.message
        : `${getProviderLabel(provider)} 로그인에 실패했습니다.`;


    const response =
      NextResponse.redirect(
        makeOAuthErrorUrl(
          request,
          message
        )
      );


    clearStateCookie(
      response,
      provider
    );


    return response;
  }
}
