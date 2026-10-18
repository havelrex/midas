import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { apiFetch } from '../lib/apiFetch';
import { scoreItem, ScoreUnavailableError } from '../lib/scoreApi';
import type { AnalysisOutput, LibraryItem, ScoreOutput } from '../../shared/contracts';
import ScoreCard from '../components/ScoreCard';
import { useTheme } from '../lib/theme';
import UndoBar from '../components/UndoBar';
import { type ScoreStatus, type Snap, useSaveSnap } from '../features/library/useSaveSnap';
import { saveItem } from '../features/library/api';
import { ItemDetailView } from './ItemDetailScreen';
import { createDummySnap, DUMMY_MODEL, DUMMY_TARGET_PRICE, TEST_TOOLS_ENABLED } from '../testing/dummySnap';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface Props {
  onOpenLibrary: () => void; // bottom-left
  onOpenProfile: () => void; // bottom-right
  onOpenCheckout: (itemId: string) => void; // after the card's Checkout has saved the item
}

export default function CameraScreen({ onOpenLibrary, onOpenProfile, onOpenCheckout }: Props) {
  const { colors } = useTheme(); // the detail sheet follows Light/Dark; the camera itself stays dark
  const camera = useRef<CameraView>(null);
  const captureInProgress = useRef(false);
  const session = useRef(0);
  const analysisRequest = useRef<AbortController | null>(null);
  const scoreRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const appState = useRef(AppState.currentState);
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisOutput | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [score, setScore] = useState<ScoreOutput | null>(null);
  const [scoreStatus, setScoreStatus] = useState<ScoreStatus>('scoring');
  const [detailOpen, setDetailOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  const saver = useSaveSnap({
    onRestore: showSnap,
    onSaveFailed: (snap) => {
      // Put the card back only if the user hasn't moved on to another photo.
      if (!photoUri) showSnap(snap);
      setError("Couldn't save to Library. Check your connection and swipe again.");
    },
    onUndoFailed: () => setError("Couldn't undo. The item is still in your Library; delete it from there."),
  });

  // The snap currently on screen, as the save hook needs it.
  const snap: Snap | null = photoUri && analysis ? { photoUri, analysis, score, scoreStatus } : null;

  // Card -> checkout: checkout needs a saved row, so save first (no Undo; the user chose to buy).
  // Whether it can actually be bought is the checkout screen's call (demo items only).
  async function checkout(current: Snap) {
    if (checkingOut || !current.score?.best_listing) return;
    setCheckingOut(true);
    setError(null);
    try {
      const item = await saveItem({ photoUri: current.photoUri, analysis: current.analysis, score: current.score });
      resetSnap();
      onOpenCheckout(item.id);
    } catch (e) {
      console.warn('checkout save failed:', e instanceof Error ? e.message : e);
      if (mounted.current) setError("Couldn't save this item, so checkout can't open. Check your connection and try again.");
    } finally {
      if (mounted.current) setCheckingOut(false);
    }
  }

  // Back to the live camera, dropping the current snap and any request for it.
  function resetSnap() {
    session.current += 1;
    analysisRequest.current?.abort();
    scoreRequest.current?.abort();
    setAnalyzing(false);
    setAnalysis(null);
    setScore(null);
    setScoreStatus('scoring');
    setDetailOpen(false);
    setReady(false);
    setPhotoUri(null);
    setError(null);
  }

  // Puts a swiped-away card back (Undo of a delete, or a save that failed).
  function showSnap(restored: Snap) {
    resetSnap();
    setPhotoUri(restored.photoUri);
    setAnalysis(restored.analysis);
    setScore(restored.score);
    setScoreStatus(restored.scoreStatus);
    if (restored.scoreStatus === 'scoring') void scoreAnalysis(restored.analysis, session.current);
  }

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      // Duplicate active events must not disable an already-ready preview.
      if (state === appState.current) return;
      appState.current = state;
      session.current += 1;
      analysisRequest.current?.abort();
      scoreRequest.current?.abort();
      setAnalyzing(false);
      captureInProgress.current = false;
      setCapturing(false);
      setActive(state === 'active');
      setReady(false);
      if (state === 'active') {
        // Force a fresh native preview even if inactive/active updates are batched.
        setCameraKey((key) => key + 1);
        void refreshPermission().catch(() => {
          if (mounted.current) setError('Unable to check camera permission. Try again.');
        });
      }
    });
    return () => {
      mounted.current = false;
      analysisRequest.current?.abort();
      scoreRequest.current?.abort();
      session.current += 1;
      subscription.remove();
    };
  }, [refreshPermission]);

  async function enableCamera() {
    setError(null);
    try {
      if (permission?.canAskAgain) await requestPermission();
      else await Linking.openSettings();
    } catch {
      if (mounted.current) setError('Unable to open camera permissions. Please try again.');
    }
  }

  async function takePhoto() {
    if (!camera.current || !ready || appState.current !== 'active' || !permission?.granted || cameraError || captureInProgress.current) return;
    captureInProgress.current = true;
    setCapturing(true);
    setError(null);
    setAnalysis(null);
    const currentSession = session.current;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9 });
      if (currentSession !== session.current) return;
      if (!photo?.uri) throw new Error('No photo returned');
      setReady(false);
      setPhotoUri(photo.uri);
      void identifyPhoto(photo.uri, currentSession);
    } catch {
      if (currentSession === session.current) {
        setError('Could not take the photo. Please try again.');
      }
    } finally {
      // An old capture must not unlock or overwrite a newer camera session.
      if (mounted.current && currentSession === session.current) {
        captureInProgress.current = false;
        setCapturing(false);
      }
    }
  }

  async function identifyPhoto(uri: string, currentSession: number) {
    const controller = new AbortController();
    analysisRequest.current?.abort();
    analysisRequest.current = controller;
    setAnalyzing(true);
    const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) =>
        Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
      if (controller.signal.aborted || currentSession !== session.current) return;
      // Preserve ports, seams and logos without upscaling small images or making
      // portrait uploads much larger than landscape uploads.
      const resize = Math.max(size.width, size.height) > 1600
        ? [{ resize: size.width >= size.height ? { width: 1600 } : { height: 1600 } }] : [];
      const photo = await manipulateAsync(uri, resize, {
        compress: 0.85, format: SaveFormat.JPEG, base64: true,
      });
      if (controller.signal.aborted || currentSession !== session.current) return;
      const result = await apiFetch<AnalysisOutput>('/analyze', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ imageBase64: photo.base64, mimeType: 'image/jpeg' }),
      });
      if (mounted.current && currentSession === session.current) {
        setAnalysis(result);
        // Nothing to score if Gemini couldn't name the product; the user retakes instead.
        if (result.name) void scoreAnalysis(result, currentSession);
      }
    } catch (e) {
      // Shows in the Metro terminal: network failure, timeout, or the server's status code.
      console.warn('analyze failed:', e instanceof Error ? e.message : e);
      if (mounted.current && currentSession === session.current) {
        setError('Could not identify the product. Check your connection and retry or retake.');
      }
    } finally {
      clearTimeout(timeout);
      if (mounted.current && analysisRequest.current === controller) setAnalyzing(false);
    }
  }

  async function scoreAnalysis(result: AnalysisOutput, currentSession: number) {
    const controller = new AbortController();
    scoreRequest.current?.abort();
    scoreRequest.current = controller;
    setScore(null);
    setScoreStatus('scoring');
    const timeout = setTimeout(() => controller.abort(), 40_000);
    try {
      const scored = await scoreItem(result, controller.signal);
      if (mounted.current && currentSession === session.current) {
        setScore(scored);
        setScoreStatus(scored.best_listing ? 'ready' : 'no_listing');
      }
    } catch (e) {
      const unavailable = e instanceof ScoreUnavailableError;
      if (!unavailable) console.warn('score failed:', e instanceof Error ? e.message : e);
      if (mounted.current && currentSession === session.current) setScoreStatus(unavailable ? 'unavailable' : 'error');
    } finally {
      clearTimeout(timeout);
    }
  }

  // An unsaved snap shaped like a Library row, for the tap-to-expand detail sheet.
  const draft: LibraryItem | null = snap?.score?.best_listing ? {
    id: '', user_id: '', created_at: new Date().toISOString(),
    thumbnail_url: snap.photoUri,
    name: snap.analysis.name, summary: snap.analysis.summary, category: snap.analysis.category,
    brand: snap.analysis.brand, model: snap.analysis.model,
    score: Math.round(snap.score.score), subscores: snap.score.subscores, verdict: snap.score.verdict,
    best_listing: snap.score.best_listing,
    target_price: TEST_TOOLS_ENABLED && snap.analysis.model === DUMMY_MODEL ? DUMMY_TARGET_PRICE : null,
    checkout_status: 'none',
  } : null;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      {/* Top bar stays wordless, like Apple Camera. Only the test-mode tools (off by default) show here. */}
      <View style={styles.header}>
        {TEST_TOOLS_ENABLED && <>
          <Text style={styles.testLabel}>TEST MODE - shared sample item available</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
            captureInProgress.current = false;
            setCapturing(false);
            const uri = Image.resolveAssetSource(require('../../assets/icon.png'))?.uri;
            if (!uri) { setError('Test placeholder image could not be loaded.'); return; }
            showSnap(createDummySnap(uri));
          }}><Text style={styles.buttonText}>Load dummy item</Text></Pressable>
        </>}
      </View>

      {!photoUri && !permission ? (
        <View style={styles.message}><ActivityIndicator color="#fff" /><Text style={styles.hint}>Checking camera permission…</Text></View>
      ) : !photoUri && !permission?.granted ? (
        <View style={styles.message}>
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.hint}>Allow camera access to take a photo of a product.</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={enableCamera}>
            <Text style={styles.buttonText}>{permission?.canAskAgain ? 'Allow camera access' : 'Open Settings'}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.preview}>
          {photoUri ? (
            <>
              <Image accessibilityLabel="Captured product photo" source={{ uri: photoUri }} style={styles.fill} resizeMode="contain" />
              {snap && !!snap.analysis.name && (
                <View style={styles.cardLayer} pointerEvents="box-none">
                  <ScoreCard
                    key={snap.photoUri}
                    photoUri={snap.photoUri}
                    analysis={snap.analysis}
                    score={snap.score}
                    status={snap.scoreStatus}
                    onSave={() => { saver.save(snap); resetSnap(); }}
                    onDelete={() => { saver.discard(snap); resetSnap(); }}
                    onOpen={() => setDetailOpen(true)}
                    onRetry={() => void scoreAnalysis(snap.analysis, session.current)}
                    onCheckout={() => void checkout(snap)}
                    checkingOut={checkingOut}
                  />
                </View>
              )}
            </>
          ) : active && !cameraError ? (
            <CameraView
              key={cameraKey}
              ref={camera}
              style={styles.fill}
              facing="back"
              mode="picture"
              onCameraReady={() => setReady(true)}
              onMountError={() => {
                setReady(false);
                setCameraError(true);
                setError('Camera could not start. Please try again.');
              }}
            />
          ) : (
            <View style={styles.message}>
              <Text style={styles.hint}>{cameraError ? 'Camera unavailable' : 'Camera paused'}</Text>
              {cameraError && <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
                setError(null);
                setCameraError(false);
                setReady(false);
                setCameraKey((key) => key + 1);
              }}><Text style={styles.buttonText}>Retry camera</Text></Pressable>}
            </View>
          )}
        </View>
      )}

      {analyzing && <View style={styles.result}><ActivityIndicator color="#fff" /><Text style={styles.hint}>Identifying product...</Text></View>}
      {analysis && !analysis.name && <View style={styles.result}>
        <Text style={styles.title}>{analysis.name || 'Product not identified'}</Text>
        <Text style={styles.hint}>{[analysis.brand, analysis.model].filter(Boolean).join(' · ')}</Text>
        <Text style={styles.hint}>{analysis.summary}</Text>
        {!analysis.model && <Text style={styles.hint}>Exact model unknown. Retake with the model label visible.</Text>}
      </View>}
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {photoUri && !analyzing && !analysis && <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
        setError(null);
        void identifyPhoto(photoUri, session.current);
      }}><Text style={styles.buttonText}>Retry identification</Text></Pressable>}
      {saver.banner && (
        <UndoBar
          key={saver.banner.id}
          message={saver.banner.message}
          onUndo={saver.banner.undo}
          onExpire={() => saver.dismiss(saver.banner!.id)}
        />
      )}
      {/* Apple Camera layout: Library bottom-left, shutter center, Profile bottom-right. */}
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Library"
          onPress={onOpenLibrary}
          hitSlop={8}
          style={({ pressed }) => [styles.side, pressed && styles.disabled]}
        >
          <View style={styles.gridIcon}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={styles.gridCell} />)}
          </View>
        </Pressable>
        <View style={styles.center}>
          {/* A test-mode dummy snap can show without camera permission; Retake still needs to work. */}
          {(permission?.granted || photoUri) && (photoUri ? (
            <Pressable accessibilityRole="button" style={styles.button} onPress={resetSnap}>
              <Text style={styles.buttonText}>Retake photo</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo"
              accessibilityState={{ disabled: !ready || capturing || !active, busy: capturing }}
              disabled={!ready || capturing || !active}
              onPress={takePhoto}
              style={[styles.shutter, (!ready || capturing || !active) && styles.disabled]}
            >
              {capturing ? <ActivityIndicator color="#fff" /> : <View style={styles.shutterCenter} />}
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Profile"
          onPress={onOpenProfile}
          hitSlop={8}
          style={({ pressed }) => [styles.side, pressed && styles.disabled]}
        >
          <View style={styles.personHead} />
          <View style={styles.personBody} />
        </Pressable>
      </View>

      <Modal visible={detailOpen && !!draft} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => setDetailOpen(false)}>
        <View style={[styles.sheetBar, { backgroundColor: colors.groupedBackground }]}>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDetailOpen(false)}>
            <Text style={[styles.sheetDone, { color: colors.tint }]}>Done</Text>
          </Pressable>
        </View>
        {draft && snap && <ItemDetailView item={draft} onCheckout={() => { setDetailOpen(false); void checkout(snap); }} />}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  testLabel: { color: '#ffcc00', fontSize: 13, textAlign: 'center' },
  result: { padding: 16, gap: 8 },
  header: { alignItems: 'center', padding: 16, gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600', textAlign: 'center' },
  hint: { color: '#ccc', fontSize: 16, textAlign: 'center' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  preview: { flex: 1, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  cardLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }, // background from the theme
  sheetDone: { fontSize: 17, fontWeight: '600' }, // color from the theme
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 112, padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Library / Profile: drawn icons (no icon package) in 52pt circles.
  side: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  gridIcon: { width: 22, height: 22, flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  gridCell: { width: 9.5, height: 9.5, borderRadius: 2.5, backgroundColor: '#fff' },
  personHead: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  personBody: { width: 20, height: 9, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: '#fff', marginTop: 2 },
  button: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 28 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterCenter: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  disabled: { opacity: 0.4 },
  error: { color: '#ffb4ab', textAlign: 'center', padding: 12 },
});
