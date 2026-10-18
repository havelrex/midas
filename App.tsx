import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import SignInScreen from './app/screens/SignInScreen';
import CameraScreen from './app/screens/CameraScreen';
import LibraryScreen from './app/screens/LibraryScreen';
import ItemDetailScreen from './app/screens/ItemDetailScreen';
import ProfileScreen from './app/screens/ProfileScreen';
import CheckoutScreen from './app/screens/CheckoutScreen';
import { ThemeProvider } from './app/lib/ThemeProvider';

export default function App() {
  return <ThemeProvider><AuthProvider><Root /></AuthProvider></ThemeProvider>;
}

function Root() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;
  // Keyed by user so signing out and back in starts again at the camera.
  return <SignedIn key={session.user.id} />;
}

type Screen =
  | { name: 'camera' }
  | { name: 'library' }
  | { name: 'item'; id: string }
  | { name: 'checkout'; id: string; from: 'camera' | 'item' };

// Camera -> Library (bottom-left) -> Item detail. Profile is a sheet over the camera (bottom-right).
// Checkout opens from the score card (after it saves the item) or from a saved item's detail.
function SignedIn() {
  const [screen, setScreen] = useState<Screen>({ name: 'camera' });
  const [profileOpen, setProfileOpen] = useState(false);
  if (screen.name === 'checkout') {
    const fromCamera = screen.from === 'camera';
    return (
      <CheckoutScreen
        key={screen.id}
        itemId={screen.id}
        backLabel={fromCamera ? 'Camera' : 'Item'}
        onBack={() => setScreen(fromCamera ? { name: 'camera' } : { name: 'item', id: screen.id })}
      />
    );
  }

  if (screen.name === 'library') {
    return (
      <LibraryScreen
        onBack={() => setScreen({ name: 'camera' })}
        onOpenItem={(id) => setScreen({ name: 'item', id })}
      />
    );
  }
  if (screen.name === 'item') {
    return (
      <ItemDetailScreen
        id={screen.id}
        onBack={() => setScreen({ name: 'library' })}
        onCheckout={(item) => {
          // In-app sample items (EXPO_PUBLIC_MOCK_LIBRARY) have no saved row, so the server can't check them out.
          if (item.id.startsWith('mock-')) Alert.alert('Sample item', "Sample items can't be checked out.");
          else setScreen({ name: 'checkout', id: item.id, from: 'item' });
        }}
      />
    );
  }
  return (
    <View style={styles.container}>
      <CameraScreen
        onOpenLibrary={() => setScreen({ name: 'library' })}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenCheckout={(id) => setScreen({ name: 'checkout', id, from: 'camera' })}
      />
      <ProfileScreen visible={profileOpen} onClose={() => setProfileOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
});
