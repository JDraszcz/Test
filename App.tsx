import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type WeekDay = 'Lundi' | 'Mardi' | 'Mercredi' | 'Jeudi' | 'Vendredi';

type CourseEvent = {
  id: string;
  day: WeekDay;
  title: string;
  startTime: string;
  endTime: string;
  audioEnabled: boolean;
  micOffMode: boolean;
  audioFile?: {
    filename: string;
    format: 'm4a';
    estimatedSizeKb: number;
  };
  transcription?: string;
  summary?: string;
  imageConcept?: string;
};

const weekDays: WeekDay[] = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

const initialForm = {
  day: 'Lundi' as WeekDay,
  title: '',
  startTime: '',
  endTime: '',
  audioEnabled: true,
  micOffMode: true,
};

export default function App() {
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [form, setForm] = useState(initialForm);

  const weeklyAgenda = useMemo(
    () =>
      weekDays.map((day) => ({
        day,
        events: events.filter((event) => event.day === day),
      })),
    [events],
  );

  const createTranscript = (title: string, micOffMode: boolean) =>
    micOffMode
      ? `Transcription (micro éteint simulé) : cours de ${title}. Captation optimisée pour limiter la taille du fichier audio.`
      : `Transcription (micro actif simulé) : points abordés pendant le cours de ${title}.`;

  const createSummary = (title: string) =>
    `Synthèse : notions essentielles de ${title}, à convertir en fiche de révision.`;

  const createImageConcept = (title: string) =>
    `Image suggérée : schéma pédagogique pour ${title} (mind map + points clés du cours).`;

  const addEvent = () => {
    if (!form.title.trim() || !form.startTime.trim() || !form.endTime.trim()) {
      return;
    }

    const eventId = `${Date.now()}`;
    const hasAudio = form.audioEnabled;

    const nextEvent: CourseEvent = {
      id: eventId,
      day: form.day,
      title: form.title.trim(),
      startTime: form.startTime.trim(),
      endTime: form.endTime.trim(),
      audioEnabled: hasAudio,
      micOffMode: hasAudio ? form.micOffMode : false,
      audioFile: hasAudio
        ? {
            filename: `cours-${eventId}.m4a`,
            format: 'm4a',
            estimatedSizeKb: form.micOffMode ? 220 : 640,
          }
        : undefined,
      transcription: hasAudio ? createTranscript(form.title.trim(), form.micOffMode) : undefined,
      summary: hasAudio ? createSummary(form.title.trim()) : undefined,
      imageConcept: hasAudio ? createImageConcept(form.title.trim()) : undefined,
    };

    setEvents((previous) => [...previous, nextEvent]);
    setForm(initialForm);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Agenda cours (Lundi → Vendredi)</Text>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>Ajouter un évènement</Text>

        <Text style={styles.label}>Jour</Text>
        <View style={styles.dayRow}>
          {weekDays.map((day) => (
            <Pressable
              key={day}
              style={[styles.dayButton, form.day === day && styles.dayButtonSelected]}
              onPress={() => setForm((previous) => ({ ...previous, day }))}
            >
              <Text style={form.day === day ? styles.dayButtonTextSelected : styles.dayButtonText}>{day}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Cours</Text>
        <TextInput
          style={styles.input}
          value={form.title}
          onChangeText={(title) => setForm((previous) => ({ ...previous, title }))}
          placeholder="Ex: Mathématiques"
        />

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.label}>Début</Text>
            <TextInput
              style={styles.input}
              value={form.startTime}
              onChangeText={(startTime) => setForm((previous) => ({ ...previous, startTime }))}
              placeholder="08:30"
            />
          </View>
          <View style={styles.timeField}>
            <Text style={styles.label}>Fin</Text>
            <TextInput
              style={styles.input}
              value={form.endTime}
              onChangeText={(endTime) => setForm((previous) => ({ ...previous, endTime }))}
              placeholder="10:00"
            />
          </View>
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Proposer un enregistrement audio</Text>
          <Switch
            value={form.audioEnabled}
            onValueChange={(audioEnabled) => setForm((previous) => ({ ...previous, audioEnabled }))}
          />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Mode micro éteint (audio plus léger)</Text>
          <Switch
            value={form.micOffMode}
            disabled={!form.audioEnabled}
            onValueChange={(micOffMode) => setForm((previous) => ({ ...previous, micOffMode }))}
          />
        </View>

        <Pressable style={styles.primaryButton} onPress={addEvent}>
          <Text style={styles.primaryButtonText}>Ajouter au planning</Text>
        </Pressable>
      </View>

      {weeklyAgenda.map(({ day, events: dayEvents }) => (
        <View key={day} style={styles.dayCard}>
          <Text style={styles.dayTitle}>{day}</Text>
          {dayEvents.length === 0 ? (
            <Text style={styles.emptyText}>Aucun cours planifié.</Text>
          ) : (
            dayEvents.map((event) => (
              <View key={event.id} style={styles.eventCard}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <Text style={styles.eventTime}>
                  {event.startTime} - {event.endTime}
                </Text>

                {event.audioEnabled && event.audioFile ? (
                  <View style={styles.outputBlock}>
                    <Text style={styles.outputTitle}>Audio</Text>
                    <Text style={styles.outputText}>
                      {event.audioFile.filename} ({event.audioFile.format.toUpperCase()}) • ~{event.audioFile.estimatedSizeKb} KB
                    </Text>
                    <Text style={styles.outputText}>
                      Mode: {event.micOffMode ? 'Micro éteint (simulé)' : 'Micro actif (simulé)'}
                    </Text>

                    <Text style={styles.outputTitle}>Transcription</Text>
                    <Text style={styles.outputText}>{event.transcription}</Text>

                    <Text style={styles.outputTitle}>Synthèse</Text>
                    <Text style={styles.outputText}>{event.summary}</Text>

                    <Text style={styles.outputTitle}>Création d'image</Text>
                    <Text style={styles.outputText}>{event.imageConcept}</Text>
                  </View>
                ) : (
                  <Text style={styles.outputText}>Pas d'enregistrement demandé.</Text>
                )}
              </View>
            ))
          )}
        </View>
      ))}
      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    backgroundColor: '#f4f6fb',
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  dayButton: {
    borderWidth: 1,
    borderColor: '#d0d7e5',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dayButtonSelected: {
    backgroundColor: '#2246d2',
    borderColor: '#2246d2',
  },
  dayButtonText: {
    color: '#334',
    fontSize: 12,
  },
  dayButtonTextSelected: {
    color: '#fff',
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d5d9e3',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  timeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeField: {
    flex: 1,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 12,
  },
  switchLabel: {
    flex: 1,
    fontSize: 14,
  },
  primaryButton: {
    backgroundColor: '#2246d2',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  dayCard: {
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: '#666',
  },
  eventCard: {
    borderTopWidth: 1,
    borderTopColor: '#edf0f6',
    paddingTop: 10,
    marginTop: 10,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  eventTime: {
    fontSize: 13,
    color: '#333',
    marginBottom: 8,
  },
  outputBlock: {
    backgroundColor: '#f8f9ff',
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  outputTitle: {
    fontSize: 13,
    marginTop: 4,
    fontWeight: '700',
  },
  outputText: {
    fontSize: 13,
    color: '#333',
  },
});
