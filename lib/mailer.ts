import nodemailer from "nodemailer";

import type {
  VerificationPurpose,
} from "@/lib/email-verification";


type SendVerificationCodeArgs = {
  to: string;
  code: string;
  purpose: VerificationPurpose;
};


function getMailerConfig() {
  const host =
    process.env.SMTP_HOST ??
    "smtp.gmail.com";

  const port =
    Number(
      process.env.SMTP_PORT ??
      "465"
    );

  const user =
    process.env.SMTP_USER;

  const pass =
    process.env.SMTP_PASS;

  const from =
    process.env.MAIL_FROM ??
    user;

  if (
    !user ||
    !pass ||
    !from
  ) {
    throw new Error(
      "SMTP_USER, SMTP_PASS, MAIL_FROM 환경변수를 확인해주세요."
    );
  }

  return {
    host,
    port,
    user,
    pass,
    from,
  };
}


function getTransporter() {
  const config =
    getMailerConfig();

  return nodemailer.createTransport({
    host:
      config.host,

    port:
      config.port,

    secure:
      config.port === 465,

    auth: {
      user:
        config.user,

      pass:
        config.pass,
    },
  });
}


export async function sendVerificationCodeEmail({
  to,
  code,
  purpose,
}: SendVerificationCodeArgs) {
  const config =
    getMailerConfig();

  const transporter =
    getTransporter();

  const isSignup =
    purpose ===
    "signup";

  const subject =
    isSignup
      ? "[점메추] 회원가입 이메일 인증번호"
      : "[점메추] 비밀번호 재설정 인증번호";

  const title =
    isSignup
      ? "회원가입 이메일 인증"
      : "비밀번호 재설정";

  await transporter.sendMail({
    from:
      config.from,

    to,

    subject,

    text:
      `${title}\n\n` +
      `인증번호: ${code}\n\n` +
      `인증번호는 10분 동안 유효합니다.\n` +
      `본인이 요청하지 않았다면 이 메일을 무시해주세요.`,

    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#1f2937">
        <div style="font-size:14px;font-weight:800;color:#f97316;margin-bottom:8px">
          점메추
        </div>

        <h1 style="font-size:22px;margin:0 0 12px">
          ${title}
        </h1>

        <p style="font-size:14px;line-height:1.7;color:#6b7280">
          아래 인증번호를 점메추 화면에 입력해주세요.
        </p>

        <div style="margin:24px 0;padding:20px;border-radius:16px;background:#fff7ed;text-align:center">
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#ea580c">
            ${code}
          </div>
        </div>

        <p style="font-size:13px;line-height:1.7;color:#9ca3af">
          인증번호는 10분 동안 유효합니다.<br />
          본인이 요청하지 않았다면 이 메일을 무시해주세요.
        </p>
      </div>
    `,
  });
}
