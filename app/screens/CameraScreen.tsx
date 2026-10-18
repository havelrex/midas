import { useEffect, useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { apiFetch } from '../lib/apiFetch';
import type { AnalysisOutput } from '../../shared/contracts';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export default function CameraScreen() {
  const camera = useRef<CameraView>(null);
  const captureInProgress = useRef(false);
  const session = useRef(0);
  const analysisRequest = useRef<AbortController | null>(null);
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

  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', (state) => {
      // Duplicate active events must not disable an already-ready preview.
      if (state === appState.current) return;
      appState.current = state;
      session.current += 1;
      analysisRequest.current?.abort();
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
      const photo = await camera.current.takePictureAsync({ quality: 0.7 });
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
      const photo = await manipulateAsync(uri, [{ resize: { width: 1280 } }], {
        compress: 0.7, format: SaveFormat.JPEG, base64: true,
      });
      if (controller.signal.aborted || currentSession !== session.current) return;
      const result = await apiFetch<AnalysisOutput>('/analyze', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify({ imageBase64: photo.base64, mimeType: 'image/jpeg' }),
      });
      if (mounted.current && currentSession === session.current) setAnalysis(result);
    } catch {
      if (mounted.current && currentSession === session.current) {
        setError('Could not identify the product. Check your connection and retry or retake.');
      }
    } finally {
      clearTimeout(timeout);
      if (mounted.current && analysisRequest.current === controller) setAnalyzing(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Snap & Score</Text>
        <Text style={styles.hint}>{photoUri ? 'Photo captured' : 'Center one product in the frame'}</Text>
      </View>

      {!permission ? (
        <View style={styles.message}><ActivityIndicator color="#fff" /><Text style={styles.hint}>Checking camera permission…</Text></View>
      ) : !permission.granted ? (
        <View style={styles.message}>
          <Text style={styles.title}>Camera access needed</Text>
          <Text style={styles.hint}>Allow camera access to take a photo of a product.</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={enableCamera}>
            <Text style={styles.buttonText}>{permission.canAskAgain ? 'Allow camera access' : 'Open Settings'}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.preview}>
          {photoUri ? (
            <Image accessibilityLabel="Captured product photo" source={{ uri: photoUri }} style={styles.fill} resizeMode="contain" />
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
      {analysis && <View style={styles.result}>
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
      {permission?.granted && <View style={styles.controls}>
        {photoUri ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={() => {
            session.current += 1;
            analysisRequest.current?.abort();
            setAnalyzing(false);
            setAnalysis(null);
            setReady(false);
            setPhotoUri(null);
            setError(null);
          }}><Text style={styles.buttonText}>Retake photo</Text></Pressable>
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
        )}
      </View>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  result: { padding: 16, gap: 8 },
  header: { alignItems: 'center', padding: 16, gap: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600', textAlign: 'center' },
  hint: { color: '#ccc', fontSize: 16, textAlign: 'center' },
  message: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  preview: { flex: 1, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  controls: { alignItems: 'center', justifyContent: 'center', minHeight: 112, padding: 16 },
  button: { backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 28 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '600' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterCenter: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  disabled: { opacity: 0.4 },
  error: { color: '#ffb4ab', textAlign: 'center', padding: 12 },
});
