import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { PaymentMethod } from '@diary/core';
import { ApiError, type ApiClient } from '../lib/api';
import { buildTrip, issuesToFormErrors, type TripFormValues } from '../lib/tripForm';
import { colors, radius } from '../theme';

interface Props {
  api: ApiClient;
  date: string;
  utcOffset: string;
  dayTitle: string;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY: TripFormValues = { start: '', end: '', amount: '', commission: '', payment: 'card' };

/**
 * Mounted only while open, so every opening gets a fresh trip id. The id is created once
 * and reused for every retry of this form — that is what makes "save" safe to press again
 * after a network error (ADR-0003).
 */
export function AddTripSheet({ api, date, utcOffset, dayTitle, onClose, onSaved }: Props) {
  const [tripId] = useState(() => randomUUID());
  const [values, setValues] = useState<TripFormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof TripFormValues, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (field: keyof TripFormValues) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  };

  async function save() {
    if (saving) return;
    setBanner(null);
    const result = buildTrip(values, { id: tripId, date, utcOffset });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await api.createTrip(result.trip);
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.issues.length > 0) {
        setErrors(issuesToFormErrors(error.issues));
      } else if (error instanceof ApiError) {
        setBanner(error.message);
      } else {
        setBanner('Нет связи с сервером. Нажмите «Сохранить» ещё раз — поездка не задвоится.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Новая поездка</Text>
            <Text style={styles.subtitle}>{dayTitle}</Text>

            <View style={styles.row2}>
              <Field label="Начало" error={errors.start}>
                <TextInput
                  testID="input-start"
                  style={styles.input}
                  value={values.start}
                  onChangeText={set('start')}
                  placeholder="08:10"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </Field>
              <Field label="Окончание" error={errors.end}>
                <TextInput
                  testID="input-end"
                  style={styles.input}
                  value={values.end}
                  onChangeText={set('end')}
                  placeholder="08:32"
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </Field>
            </View>

            <View style={styles.row2}>
              <Field label="Сумма, ₸" error={errors.amount}>
                <TextInput
                  testID="input-amount"
                  style={styles.input}
                  value={values.amount}
                  onChangeText={set('amount')}
                  placeholder="2400"
                  keyboardType="number-pad"
                />
              </Field>
              <Field label="Комиссия, ₸" error={errors.commission}>
                <TextInput
                  testID="input-commission"
                  style={styles.input}
                  value={values.commission}
                  onChangeText={set('commission')}
                  placeholder="360"
                  keyboardType="number-pad"
                />
              </Field>
            </View>

            <Text style={styles.label}>Оплата</Text>
            <View style={styles.segment}>
              {(['card', 'cash'] as PaymentMethod[]).map((method) => (
                <Pressable
                  key={method}
                  testID={`payment-${method}`}
                  onPress={() => setValues((v) => ({ ...v, payment: method }))}
                  style={[styles.segmentItem, values.payment === method && styles.segmentActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: values.payment === method }}
                >
                  <Text style={styles.segmentText}>{method === 'card' ? 'Карта' : 'Наличные'}</Text>
                </Pressable>
              ))}
            </View>

            {banner && <Text style={styles.banner}>{banner}</Text>}

            <View style={styles.actions}>
              <Pressable style={[styles.button, styles.secondary]} onPress={onClose}>
                <Text style={styles.buttonText}>Отмена</Text>
              </Pressable>
              <Pressable
                testID="save-trip"
                style={[styles.button, styles.primary, saving && styles.disabled]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentText} />
                ) : (
                  <Text style={styles.buttonText}>Сохранить</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.muted, marginBottom: 16 },
  row2: { flexDirection: 'row', gap: 12 },
  field: { flex: 1, marginBottom: 12 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  error: { color: colors.negative, fontSize: 12, marginTop: 4 },
  segment: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  segmentText: { fontWeight: '600', color: colors.text },
  banner: {
    backgroundColor: '#FEF2F2',
    color: colors.negative,
    padding: 12,
    borderRadius: radius,
    marginBottom: 12,
  },
  actions: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.background },
  disabled: { opacity: 0.6 },
  buttonText: { fontWeight: '700', fontSize: 16, color: colors.accentText },
});
