import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import SignInScreen from './app/screens/SignInScreen';
import CameraScreen from './app/screens/CameraScreen';

export default function App() {
  return <AuthProvider><Root /></AuthProvider>;
}

// Keep temporary sign-out access until profile navigation is connected.
function Root() {
  const { session, loading, signOut } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;
  return (
    <View style={styles.container}>
      <CameraScreen />
      <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  signOut: { padding: 14, alignItems: 'center' },
  signOutText: { color: '#ffb4ab', fontSize: 16 },
});
