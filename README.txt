점메추 친구 수락 Internal Server Error - 최종 라우트 충돌 수정

원인:
Next.js App Router에서 같은 동적 경로 레벨에
[id]와 [friendshipId]를 동시에 둘 수 없습니다.

현재 충돌:
app/api/friends/[id]/route.ts
app/api/friends/[friendshipId]/accept/route.ts
app/api/friends/[friendshipId]/reject/route.ts

수정 후:
app/api/friends/[id]/route.ts
app/api/friends/[id]/accept/route.ts
app/api/friends/[id]/reject/route.ts

중요:
ZIP을 C:\project\project 에 덮어쓴 뒤 반드시 아래 명령으로
기존 [friendshipId] 폴더를 삭제하세요.

PowerShell:
Remove-Item -LiteralPath "C:\project\project\app\api\friends\[friendshipId]" -Recurse -Force

또는 프로젝트 루트에서:
.\apply_friend_route_fix.ps1

그 다음:
npm run build

프론트 요청 URL은 그대로입니다:
POST /api/friends/{friendshipId}/accept
POST /api/friends/{friendshipId}/reject

URL에는 파라미터 변수명이 노출되지 않으므로 page.tsx는 수정할 필요가 없습니다.
