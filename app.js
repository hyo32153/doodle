import { CLASSES } from "./classes.js";
import {
  draw,
  initCanvas,
  redrawAllStrokes,
  startDrawing,
  stopDrawing,
} from "./modules/drawing.js";
import { loadModel, predict, schedulePrediction } from "./modules/inference.js";
import { getInputTensor } from "./modules/preprocess.js";
import { renderPredictions } from "./modules/ui.js";

// --- 앱 전역 설정값 ---
// TensorFlow.js가 로딩할 모델 경로
const MODEL_URL = "./model/model.json";
// 화면에 표시할 상위 예측 개수
const TOP_K = 5;
// 사용자가 그리기를 잠시 멈춘 뒤 예측을 실행하기까지의 지연(ms)
const DEBOUNCE_MS = 500;
// 모델 입력 이미지의 한 변 길이(28x28)
const MODEL_INPUT_SIZE = 28;

// --- DOM 참조 ---
// 메인 드로잉 캔버스와 2D 컨텍스트
const canvas = document.getElementById("drawing-canvas");
// 픽셀 읽기(getImageData)를 자주 수행하므로 브라우저 힌트를 활성화
const ctx = canvas.getContext("2d", { willReadFrequently: true });
// UI 제어 요소
const clearBtn = document.getElementById("clear-btn");
const undoBtn = document.getElementById("undo-btn");
const predictionsEl = document.getElementById("predictions");
const statusEl = document.getElementById("status");
// 모델 입력(28x28) 디버그 시각화를 위한 프리뷰 캔버스
const previewCanvas = document.getElementById("preview-canvas");
const previewCtx = previewCanvas.getContext("2d");

// --- 앱 상태 ---
// model: 로드된 tf.LayersModel
// isDrawing: 현재 포인터 다운 상태 여부
// strokes: 완료된 획(stroke) 목록. 각 획은 좌표 배열([{x,y}, ...])
// currentStroke: 현재 그리는 중인 획
// debounceTimer: 예측 디바운스 타이머 핸들
const state = {
  model: null,
  isDrawing: false,
  strokes: [],
  currentStroke: [],
  debounceTimer: null,
};

// 현재 상태를 바탕으로 예측 파이프라인 실행
// 1) strokes -> 28x28 tensor 전처리
// 2) 모델 추론
// 3) 상위 TOP_K 결과 렌더링
const runPrediction = () =>
  predict(state, {
    classes: CLASSES,
    topK: TOP_K,
    getInputTensor: (strokes) =>
      getInputTensor(strokes, MODEL_INPUT_SIZE, previewCtx),
    renderPredictions: (predictions) =>
      renderPredictions(predictionsEl, predictions),
  });

// 짧은 시간 안에 이벤트가 연속 발생해도 예측 호출을 하나로 합치기 위한 래퍼
const schedulePredictionRun = () =>
  schedulePrediction(state, runPrediction, DEBOUNCE_MS);

// 캔버스/획/예측 결과를 모두 초기화
function clearCanvas() {
  state.strokes = [];
  state.currentStroke = [];
  initCanvas(canvas, ctx);
  renderPredictions(predictionsEl, []);
}

// 마지막 획 1개만 제거하고 화면을 다시 그림
function undo() {
  if (state.strokes.length === 0) return;
  state.strokes.pop();
  redrawAllStrokes(state, canvas, ctx);
  schedulePredictionRun();
}

// --- 포인터 이벤트 바인딩 ---
// 마우스 입력
canvas.addEventListener("mousedown", (e) =>
  startDrawing(e, { state, canvas, ctx }),
);
canvas.addEventListener("mousemove", (e) => draw(e, { state, canvas, ctx }));
canvas.addEventListener("mouseup", (e) =>
  stopDrawing(e, { state, onStrokeEnd: schedulePredictionRun }),
);
canvas.addEventListener("mouseleave", (e) =>
  stopDrawing(e, { state, onStrokeEnd: schedulePredictionRun }),
);

// 터치 입력 (모바일 스크롤/줌 충돌 방지를 위해 passive: false)
canvas.addEventListener(
  "touchstart",
  (e) => startDrawing(e, { state, canvas, ctx }),
  { passive: false },
);
canvas.addEventListener("touchmove", (e) => draw(e, { state, canvas, ctx }), {
  passive: false,
});
canvas.addEventListener(
  "touchend",
  (e) => stopDrawing(e, { state, onStrokeEnd: schedulePredictionRun }),
  { passive: false },
);
canvas.addEventListener(
  "touchcancel",
  (e) => stopDrawing(e, { state, onStrokeEnd: schedulePredictionRun }),
  { passive: false },
);

// 버튼 이벤트
clearBtn.addEventListener("click", clearCanvas);
undoBtn.addEventListener("click", undo);

// --- 초기화 ---
// 1) 캔버스 기본 스타일/배경 초기화
// 2) 모델 로드 시작
initCanvas(canvas, ctx);
loadModel(state, MODEL_URL, statusEl);
