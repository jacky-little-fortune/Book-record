let loader = null;
let scanner = null;
let stopRequested = false;

export function loadScannerLibrary() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/html5-qrcode.min.js', import.meta.url).href;
    script.onload = () => {
      if (window.Html5Qrcode) resolve();
      else reject(new Error('missing'));
    };
    script.onerror = () => reject(new Error('load'));
    document.head.appendChild(script);
  });
  loader.catch(() => {
    loader = null;
  });
  return loader;
}

export function cameraMessage(error) {
  const name = error?.name || '';
  const text = `${error?.message || ''}`;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || /permission|not allowed|denied/i.test(text)) {
    return '未獲相機權限。請在 Safari 設定允許此網站使用相機，或改為輸入 ISBN 再按「查資料」。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || /not found|no camera|devices/i.test(text)) {
    return '這部裝置沒有可用的相機。請輸入 ISBN，再按「查資料」。';
  }
  if (name === 'NotReadableError' || name === 'AbortError' || /could not start|in use/i.test(text)) {
    return '相機暫時無法開啟。請關閉其他正在使用相機的程式，或改為輸入 ISBN。';
  }
  if (name === 'NotSupportedError' || /secure|https/i.test(text)) {
    return '這部瀏覽器不能使用相機。請輸入 ISBN，再按「查資料」。';
  }
  return '無法開啟相機。請改為輸入 ISBN，再按「查資料」。';
}

export function primeCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = new Error('no-media');
    error.name = 'NotSupportedError';
    return Promise.reject(error);
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  });
}

function releaseStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

export async function stopIsbnScan() {
  stopRequested = true;
  const current = scanner;
  scanner = null;
  if (!current) return;
  try {
    if (current.isScanning) await current.stop();
  } catch {
    /* already stopped */
  }
  try {
    current.clear();
  } catch {
    /* region already gone */
  }
}

export async function startIsbnScan({ elementId, onCode, onError }) {
  await stopIsbnScan();
  stopRequested = false;
  try {
    await loadScannerLibrary();
  } catch {
    onError('掃描元件載入失敗。請在有網絡時再開啟一次，或改為輸入 ISBN 後按「查資料」。');
    return;
  }
  if (stopRequested) return;
  const region = document.getElementById(elementId);
  if (!region) return;
  region.replaceChildren();
  const formats = window.Html5QrcodeSupportedFormats || {};
  const wanted = [formats.EAN_13, formats.EAN_8, formats.UPC_A, formats.UPC_E].filter((format) => format != null);
  const instance = new window.Html5Qrcode(elementId, {
    verbose: false,
    formatsToSupport: wanted,
    useBarCodeDetectorIfSupported: true,
  });
  scanner = instance;
  let finished = false;
  const box = (width, height) => ({
    width: Math.max(180, Math.floor(width * 0.88)),
    height: Math.max(72, Math.floor(Math.min(height * 0.36, 150))),
  });
  const config = { fps: 8, qrbox: box, aspectRatio: 1.777 };
  const handleCode = (raw) => {
    if (finished || stopRequested) return;
    finished = true;
    onCode(raw);
  };
  const begin = async (camera) => {
    await instance.start(camera, config, handleCode, () => {});
    if (stopRequested) await stopIsbnScan();
  };
  try {
    await begin({ facingMode: 'environment' });
  } catch (error) {
    if (stopRequested) return;
    try {
      await begin({ facingMode: 'user' });
    } catch (fallbackError) {
      if (scanner === instance) scanner = null;
      onError(cameraMessage(fallbackError || error));
    }
  }
}

export { releaseStream };
