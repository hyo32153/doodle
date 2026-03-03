// 사용자 획(strokes)을 모델 입력 텐서([1, size, size, 1])로 변환한다.
// 변환 과정은 Quick Draw 스타일에 맞춰 "내용 20x20 + 패딩 4" 정규화를 수행한다.
export function getInputTensor(strokes, modelInputSize, previewCtx) {
  // 획이 없으면 추론할 입력이 없으므로 null 반환
  if (strokes.length === 0) return null;

  // 모든 점을 평탄화해서 전체 바운딩 박스 계산에 사용
  const allPoints = strokes.flat();
  if (allPoints.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of allPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const drawW = maxX - minX;
  const drawH = maxY - minY;
  // 점 하나 수준의 입력은 정보량이 거의 없으므로 예측을 생략
  if (drawW < 1 && drawH < 1) return null;

  // 실제 내용은 20x20에 맞추고, 주변 4px 패딩을 둬 최종 28x28 형태 유지
  const contentSize = 20;
  const offset = 4;
  // 긴 변 기준으로 동일 스케일링하여 종횡비 왜곡을 방지
  const maxDim = Math.max(drawW, drawH);
  const scale = contentSize / maxDim;

  const scaledW = drawW * scale;
  const scaledH = drawH * scale;
  const offsetX = offset + (contentSize - scaledW) / 2;
  const offsetY = offset + (contentSize - scaledH) / 2;

  // 원본 캔버스와 독립적으로 전처리하기 위해 오프스크린 캔버스 사용
  const offscreen = document.createElement("canvas");
  offscreen.width = modelInputSize;
  offscreen.height = modelInputSize;
  const offCtx = offscreen.getContext("2d");

  offCtx.fillStyle = "#ffffff";
  offCtx.fillRect(0, 0, modelInputSize, modelInputSize);
  offCtx.strokeStyle = "#000000";
  offCtx.lineCap = "round";
  offCtx.lineJoin = "round";
  // 28x28 기준에서 재현 가능한 선 두께를 고정값으로 사용
  offCtx.lineWidth = 1.5;

  for (const stroke of strokes) {
    if (stroke.length < 1) continue;

    offCtx.beginPath();
    const startX = (stroke[0].x - minX) * scale + offsetX;
    const startY = (stroke[0].y - minY) * scale + offsetY;
    offCtx.moveTo(startX, startY);

    for (let i = 1; i < stroke.length; i += 1) {
      const px = (stroke[i].x - minX) * scale + offsetX;
      const py = (stroke[i].y - minY) * scale + offsetY;
      offCtx.lineTo(px, py);
    }
    offCtx.stroke();
  }

  // RGBA 픽셀 데이터에서 R 채널(흑백 동일)을 사용해 0~1 값으로 정규화
  const imageData = offCtx.getImageData(0, 0, modelInputSize, modelInputSize);
  const pixels = imageData.data;
  const input = new Float32Array(modelInputSize * modelInputSize);

  for (let i = 0; i < modelInputSize * modelInputSize; i += 1) {
    const r = pixels[i * 4];
    // 배경(흰색)=0, 획(검정색)=1이 되도록 반전
    input[i] = (255 - r) / 255;
  }

  // 디버깅용 프리뷰: 모델이 실제로 보는 입력 강도를 그대로 시각화
  const previewData = previewCtx.createImageData(modelInputSize, modelInputSize);
  for (let i = 0; i < input.length; i += 1) {
    const v = Math.round(input[i] * 255);
    previewData.data[i * 4] = v;
    previewData.data[i * 4 + 1] = v;
    previewData.data[i * 4 + 2] = v;
    previewData.data[i * 4 + 3] = 255;
  }
  previewCtx.putImageData(previewData, 0, 0);

  // tfjs의 NHWC 형식 [batch, height, width, channel]로 반환
  return tf.tensor4d(input, [1, modelInputSize, modelInputSize, 1]);
}
