import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import SignInScreen from './app/screens/SignInScreen';
import CameraScreen from './app/screens/CameraScreen';
import LibraryScreen from './app/screens/LibraryScreen';
import ItemDetailScreen from './app/screens/ItemDetailScreen';
import ProfileScreen from './app/screens/ProfileScreen';

export default function App() {
  return <AuthProvider><Root /></AuthProvider>;
}

function Root() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;
  // Keyed by user so signing out and back in starts again at the camera.
  return <SignedIn key={session.user.id} />;
}

type Screen = { name: 'camera' } | { name: 'library' } | { name: 'item'; id: string };

// Camera -> Library (bottom-left) -> Item detail. Profile is a sheet over the camera (bottom-right).
function SignedIn() {
  const [screen, setScreen] = useState<Screen>({ name: 'camera' });
  const [profileOpen, setProfileOpen] = useState(false);

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
        onCheckout={(item) => console.warn('TODO(Pedro): open checkout for', item.id)}
      />
    );
  }
  return (
    <View style={styles.container}>
      <CameraScreen onOpenLibrary={() => setScreen({ name: 'library' })} onOpenProfile={() => setProfileOpen(true)} />
      <ProfileScreen visible={profileOpen} onClose={() => setProfileOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
});
