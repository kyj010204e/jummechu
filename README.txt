점메추 친구 요청 수락/거절 보강 패치

덮어쓸 위치:
C:\project\project

변경 파일:
- app/friends/page.tsx
- app/api/friends/[friendshipId]/accept/route.ts
- app/api/friends/[friendshipId]/reject/route.ts

변경 내용:
1. 수락/거절 API route를 명시적으로 보강
2. 받은 요청의 receiver_id 본인만 처리 가능
3. PENDING 상태만 ACCEPTED / REJECTED로 변경
4. 프론트에서 API가 404 HTML 등을 반환해도 조용히 실패하지 않고 오류 메시지 표시
5. 처리 중 버튼 중복 클릭 방지 + "처리 중..." 표시

적용 후:
npm run build
