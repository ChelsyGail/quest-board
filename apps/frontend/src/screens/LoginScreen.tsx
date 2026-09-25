import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import {describeError} from '../api/errors';
import FormField from '../components/FormField';
import PrimaryButton from '../components/PrimaryButton';
import {useAppContext} from '../state/AppContext';

interface LoginScreenProps {
  initialEmail?: string;
  onGoToSignUp: () => void;
}

function LoginScreen({initialEmail = '', onGoToSignUp}: LoginScreenProps) {
  const {login} = useAppContext();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setFieldErrors({});
    setGeneralError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (error) {
      const {message, fieldErrors: serverFieldErrors} = describeError(error);
      setFieldErrors(serverFieldErrors);
      setGeneralError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Log in</Text>
        {generalError ? <Text style={styles.generalError}>{generalError}</Text> : null}
        <FormField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          placeholder="jane@example.com"
          keyboardType="email-address"
        />
        <FormField
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          placeholder="Your password"
          secureTextEntry
        />
        <PrimaryButton title="Log in" onPress={handleSubmit} loading={loading} />
        <PrimaryButton
          title="Need an account? Sign up"
          onPress={onGoToSignUp}
          variant="secondary"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  content: {padding: 20},
  title: {fontSize: 24, fontWeight: '700', marginBottom: 16, color: '#1c1c1e'},
  generalError: {color: '#d70015', marginBottom: 12, fontSize: 14},
});

export default LoginScreen;
