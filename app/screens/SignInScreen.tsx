import { useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../features/auth/AuthProvider';
import { themedStyles, useTheme } from '../lib/theme';

// Supabase error text is written for developers; say what went wrong and what to do.
function friendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  if (/invalid login credentials/i.test(message)) {
    return "That email and password don't match. Check them and try again.";
  }
  if (/network|fetch/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return "Couldn't sign in. Try again.";
}

// iOS-native layout: large title up top, fields as one grouped form, the action near the thumb.
export default function SignInScreen() {
  const styles = useStyles();
  const { colors, mode } = useTheme();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  const canSubmit = !!email.trim() && !!password && !submitting;

  const onSubmit = async () => {
    // onSubmitEditing fires even while the button is disabled.
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      // On success App.tsx swaps to the camera.
      await signIn(email.trim(), password);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Snap <Text style={styles.amp}>&</Text> Score
          </Text>
          <Text style={styles.subtitle}>Snap an item. Know if it's worth buying.</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.group}>
            <View style={styles.row}>
              <Text style={styles.label} nativeID="email-label">
                Email
              </Text>
              <TextInput
                keyboardAppearance={mode}
                style={styles.input}
                accessibilityLabelledBy="email-label"
                placeholder="name@example.com"
                placeholderTextColor={colors.secondaryLabel}
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="next"
                value={email}
                onChangeText={setEmail}
                onSubmitEditing={() => passwordRef.current?.focus()}
                submitBehavior="submit"
              />
            </View>
            <View style={styles.separator} />
            <View style={styles.row}>
              <Text style={styles.label} nativeID="password-label">
                Password
              </Text>
              <TextInput
                keyboardAppearance={mode}
                ref={passwordRef}
                style={styles.input}
                accessibilityLabelledBy="password-label"
                placeholder="Required"
                placeholderTextColor={colors.secondaryLabel}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                returnKeyType="go"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={onSubmit}
              />
            </View>
          </View>

          {error && (
            <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && canSubmit && styles.buttonPressed,
            ]}
            onPress={onSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.buttonText, !canSubmit && styles.buttonTextDisabled]}>Sign in</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = themedStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.groupedBackground },
  container: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 56, paddingBottom: 16 },
  header: { gap: 8, alignItems: 'center' },
  title: { color: colors.label, fontSize: 40, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  amp: { color: colors.goodText },
  subtitle: { color: colors.secondaryLabel, fontSize: 17, lineHeight: 22, textAlign: 'center' },
  form: { gap: 16 },
  group: { backgroundColor: colors.cell, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 16 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: 16 },
  label: { color: colors.label, fontSize: 17, width: 92 },
  input: { flex: 1, color: colors.label, fontSize: 17, minHeight: 50 },
  error: { color: colors.destructive, fontSize: 15, lineHeight: 20, paddingHorizontal: 4 },
  button: {
    backgroundColor: colors.label,
    borderRadius: 14,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: colors.fill },
  buttonPressed: { opacity: 0.8 },
  buttonText: { color: colors.onPrimary, fontSize: 17, fontWeight: '600' },
  buttonTextDisabled: { color: colors.secondaryLabel },
}));
