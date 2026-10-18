import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from './app/features/auth/AuthProvider';
import { colors } from './app/lib/theme';
import SignInScreen from './app/screens/SignInScreen';

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

// Signed out -> sign in. Signed in -> straight to the camera.
function Root() {
  const { session, loading, signOut } = useAuth();
  if (loading) return null;
  if (!session) return <SignInScreen />;

  // TODO(Caleb): replace with <CameraScreen />. The sign-out button is temporary;
  // the real one lives in ProfileScreen.
  return (
    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!</Text>
      <Text style={styles.email}>Signed in as {session.user.email}</Text>
      <Pressable
        onPress={signOut}
        accessibilityRole="button"
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.5 }]}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  email: { marginTop: 8, fontSize: 15, color: colors.secondaryLabel },
  signOut: { marginTop: 24, paddingVertical: 12, paddingHorizontal: 20 },
  signOutText: { fontSize: 17, color: colors.destructive },
});
