// 캔버스를 기본 상태로 초기화한다.
// 배경은 흰색, 획은 검은색/둥근 끝/적당한 굵기로 맞춘다.
export function initCanvas(canvas, ctx) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#000000";
}

// 마우스/터치 이벤트를 캔버스 내부 픽셀 좌표로 변환한다.
// CSS 스케일(확대/축소) 영향을 보정하기 위해 실제 캔버스 크기 비율을 곱한다.
export function getPointerPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  // 터치 이벤트는 touches[0] 기준 좌표를 사용한다.
  if (e.touches) {
    return {
      x: (e.touches[0].clientX - rect.left) * scaleX,
      y: (e.touches[0].clientY - rect.top) * scaleY,
    };
  }

  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

// 드로잉 시작 시점 처리:
// 1) 모델 미로딩 상태면 입력 무시
// 2) 현재 획 배열 초기화
// 3) 캔버스 경로 시작점 설정
export function startDrawing(e, deps) {
  const { state, canvas, ctx } = deps;
  e.preventDefault();
  if (!state.model) return;

  state.isDrawing = true;
  const pos = getPointerPos(e, canvas);
  state.currentStroke = [pos];

  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

// 드로잉 진행 처리:
// 현재 좌표를 획에 누적하고, 직전 좌표에서 현재 좌표까지 선을 그린다.
export function draw(e, deps) {
  const { state, canvas, ctx } = deps;
  e.preventDefault();
  if (!state.isDrawing) return;

  const pos = getPointerPos(e, canvas);
  state.currentStroke.push(pos);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y);
}

// 드로잉 종료 처리:
// 1) currentStroke를 완료 획 목록에 저장
// 2) onStrokeEnd 콜백을 호출해 예측 예약(디바운스) 등을 수행
export function stopDrawing(e, deps) {
  const { state, onStrokeEnd } = deps;
  if (e) e.preventDefault();
  if (!state.isDrawing) return;

  state.isDrawing = false;
  if (state.currentStroke.length > 0) {
    state.strokes.push([...state.currentStroke]);
    state.currentStroke = [];
  }

  onStrokeEnd();
}

// 저장된 모든 획을 순서대로 다시 그린다.
// undo 이후 화면 복원을 위해 사용한다.
export function redrawAllStrokes(state, canvas, ctx) {
  initCanvas(canvas, ctx);

  for (const stroke of state.strokes) {
    // 점 1개짜리 획은 선분을 만들 수 없으므로 건너뛴다.
    if (stroke.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i += 1) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  }
}
