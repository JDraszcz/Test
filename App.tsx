import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Linking } from 'react-native';
import { exportEventsToNotion, getNotionAuthorizationUrl, getNotionSession } from './notion';
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
  weekKey: string;
  day: WeekDay;
  subject: string;
  title: string;
  startTime: string;
  endTime: string;
  tags: string[];
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

type WeekOption = {
  key: string;
  label: string;
};

const getMonday = (date: Date) => {
  const monday = new Date(date);
  const day = monday.getDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  monday.setDate(monday.getDate() - daysSinceMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(date);

const formatCurrentTime = () =>
  new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());

const createWeekOptions = (): WeekOption[] => {
  const currentMonday = getMonday(new Date());

  return Array.from({ length: 10 }, (_, index) => {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - index * 7);
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 4);

    return {
      key: monday.toISOString().slice(0, 10),
      label: index === 0 ? 'Cette semaine' : `Semaine du ${formatDate(monday)} au ${formatDate(friday)}`,
    };
  });
};

const weekOptions = createWeekOptions();

const initialForm = {
  day: 'Lundi' as WeekDay,
  subject: '',
  title: '',
  startTime: formatCurrentTime(),
  endTime: '',
  tags: '',
  audioEnabled: true,
  micOffMode: true,
};

export default function App() {
  const [events, setEvents] = useState<CourseEvent[]>([]);
  const [form, setForm] = useState(initialForm);
  const [selectedWeekKey, setSelectedWeekKey] = useState(weekOptions[0].key);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState('Tous');
  const [activeSubject, setActiveSubject] = useState('Toutes les matières');
  const [notionStatus, setNotionStatus] = useState('');
  const [notionConnected, setNotionConnected] = useState(false);

  useEffect(() => {
    const webCallback = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('notion_connected') === 'true';

    getNotionSession()
      .then((connected) => {
        const isConnected = connected || webCallback;
        setNotionConnected(isConnected);
        if (webCallback) {
          setNotionStatus('Compte Notion connecté. Vous pouvez exporter tous vos cours.');
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      })
      .catch(() => setNotionStatus('Le statut de la connexion Notion est indisponible pour le moment.'));

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (url.includes('notion_connected=true')) {
        setNotionConnected(true);
        setNotionStatus('Compte Notion connecté. Vous pouvez exporter tous vos cours.');
      }
    });

    return () => subscription.remove();
  }, []);

  const availableTags = useMemo(
    () => ['Tous', ...new Set(events.flatMap((event) => event.tags))],
    [events],
  );

  const availableSubjects = useMemo(
    () => ['Toutes les matières', ...new Set(events.map((event) => event.subject).filter(Boolean))],
    [events],
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    return events.filter((event) => {
      const matchesWeek = event.weekKey === selectedWeekKey;
      const matchesSubject = activeSubject === 'Toutes les matières' || event.subject === activeSubject;
      const matchesTag = activeTag === 'Tous' || event.tags.includes(activeTag);
      const matchesSearch =
        !normalizedQuery ||
        event.title.toLocaleLowerCase().includes(normalizedQuery) ||
        event.tags.some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));

      return matchesWeek && matchesSubject && matchesTag && matchesSearch;
    });
  }, [activeSubject, activeTag, events, searchQuery, selectedWeekKey]);

  const weeklyAgenda = useMemo(
    () =>
      weekDays.map((day) => ({
        day,
        events: filteredEvents.filter((event) => event.day === day),
      })),
    [filteredEvents],
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
    if (!form.title.trim() || !form.endTime.trim()) {
      return;
    }

    const eventId = `${Date.now()}`;
    const hasAudio = form.audioEnabled;
    const startTime = formatCurrentTime();

    const nextEvent: CourseEvent = {
      id: eventId,
      weekKey: selectedWeekKey,
      day: form.day,
      subject: form.subject.trim() || 'Sans matière',
      title: form.title.trim(),
      startTime,
      endTime: form.endTime.trim(),
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .filter((tag, index, tags) => tags.indexOf(tag) === index),
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

  const connectToNotion = async () => {
    const authorizationUrl = getNotionAuthorizationUrl();
    if (!authorizationUrl) {
      setNotionStatus('Configurez le backend Notion pour ouvrir la connexion.');
      return;
    }

    try {
      await Linking.openURL(authorizationUrl);
      setNotionStatus('Connexion Notion ouverte. Revenez ici après validation pour lancer l’export.');
    } catch {
      setNotionStatus('Impossible d’ouvrir la connexion Notion. Vérifiez que le backend est démarré.');
    }
  };

  const prepareNotionExport = async () => {
    if (!notionConnected) {
      setNotionStatus('Connectez-vous à Notion avant de lancer l’export complet.');
      return;
    }

    if (events.length === 0) {
      setNotionStatus('Ajoutez au moins un cours avant de lancer l’export.');
      return;
    }

    try {
      const result = await exportEventsToNotion(events);
      setNotionStatus(`${result.exported} cours exportés dans Notion.`);
    } catch (error) {
      setNotionStatus(error instanceof Error ? error.message : 'Export Notion impossible.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Agenda cours (Lundi → Vendredi)</Text>

      <View style={styles.historyMenu}>
        <Text style={styles.toolbarLabel}>Semaines et cours précédents</Text>
        {weekOptions.map((week, index) => (
          <Pressable
            key={week.key}
            style={[styles.historyMenuItem, week.key === selectedWeekKey && styles.historyMenuItemSelected]}
            onPress={() => setSelectedWeekKey(week.key)}
          >
            <Text style={week.key === selectedWeekKey ? styles.historyMenuItemTextSelected : styles.historyMenuItemText}>
              {week.label}
            </Text>
            {index > 0 && <Text style={styles.historyMenuItemHint}>Planning et cours archivés</Text>}
          </Pressable>
        ))}
        <Text style={styles.historyMenuSection}>Catégories de cours</Text>
        {availableSubjects.map((subject) => (
          <Pressable
            key={subject}
            style={[styles.historyMenuItem, subject === activeSubject && styles.historyMenuItemSelected]}
            onPress={() => setActiveSubject(subject)}
          >
            <Text style={subject === activeSubject ? styles.historyMenuItemTextSelected : styles.historyMenuItemText}>
              {subject}
            </Text>
          </Pressable>
        ))}
        <Pressable style={styles.notionMenuItem} onPress={connectToNotion}>
          <Text style={styles.notionMenuItemText}>{notionConnected ? 'Notion connecté' : 'Lier Notion'}</Text>
        </Pressable>
        <Pressable style={styles.notionExportItem} onPress={prepareNotionExport}>
          <Text style={styles.notionExportItemText}>Exporter vers Notion</Text>
        </Pressable>
        {!!notionStatus && <Text style={styles.notionStatus}>{notionStatus}</Text>}
      </View>

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

        <Text style={styles.label}>Matière</Text>
        <TextInput
          style={styles.input}
          value={form.subject}
          onChangeText={(subject) => setForm((previous) => ({ ...previous, subject }))}
          placeholder="Ex: Mathématiques"
        />

        <Text style={styles.label}>Cours</Text>
        <TextInput
          style={styles.input}
          value={form.title}
          onChangeText={(title) => setForm((previous) => ({ ...previous, title }))}
          placeholder="Ex: Mathématiques"
        />

        <Text style={styles.label}>Catégories / tags</Text>
        <TextInput
          style={styles.input}
          value={form.tags}
          onChangeText={(tags) => setForm((previous) => ({ ...previous, tags }))}
          placeholder="Ex: sciences, examen, important"
        />

        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={styles.label}>Début</Text>
            <TextInput
              style={styles.input}
              value={form.startTime}
              editable={false}
              placeholder="--:--"
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

      <View style={styles.searchCard}>
        <Text style={styles.sectionTitle}>Retrouver un cours</Text>
        <TextInput
          style={styles.input}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Rechercher un cours ou un tag"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
          {availableTags.map((tag) => (
            <Pressable
              key={tag}
              style={[styles.tagButton, activeTag === tag && styles.tagButtonSelected]}
              onPress={() => setActiveTag(tag)}
            >
              <Text style={activeTag === tag ? styles.tagButtonTextSelected : styles.tagButtonText}>{tag}</Text>
            </Pressable>
          ))}
        </ScrollView>
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
                {event.tags.length > 0 && (
                  <View style={styles.eventTagRow}>
                    {event.tags.map((tag) => (
                      <Text key={tag} style={styles.eventTag}>{tag}</Text>
                    ))}
                  </View>
                )}

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
  historyMenu: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  historyMenuItem: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderLeftWidth: 3,
    borderLeftColor: '#e3e7f0',
    borderBottomWidth: 1,
    borderBottomColor: '#edf0f6',
  },
  historyMenuItemSelected: {
    backgroundColor: '#eef2ff',
    borderLeftColor: '#2246d2',
  },
  historyMenuItemText: {
    color: '#334',
    fontWeight: '600',
  },
  historyMenuItemTextSelected: {
    color: '#2246d2',
    fontWeight: '700',
  },
  historyMenuItemHint: {
    color: '#7c8798',
    fontSize: 11,
    marginTop: 3,
  },
  historyMenuSection: {
    color: '#465166',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 4,
  },
  notionMenuItem: {
    marginTop: 14,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#19212d',
  },
  notionMenuItemText: {
    color: '#fff',
    fontWeight: '700',
  },
  notionExportItem: {
    marginTop: 6,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#19212d',
  },
  notionExportItemText: {
    color: '#19212d',
    fontWeight: '700',
  },
  toolbarLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    color: '#465166',
  },
  dropdownButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#cbd3e2',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownButtonText: {
    color: '#1e2a3b',
    fontWeight: '600',
  },
  dropdownChevron: {
    color: '#2246d2',
    fontSize: 12,
  },
  dropdownMenu: {
    width: '92%',
    maxHeight: '78%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd3e2',
    borderRadius: 10,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#1e2a3b',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  inlineDropdownMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#cbd3e2',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(16, 24, 40, 0.48)',
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0f6',
  },
  dropdownItemSelected: {
    backgroundColor: '#eef2ff',
  },
  dropdownItemText: {
    color: '#334',
  },
  dropdownItemTextSelected: {
    color: '#2246d2',
    fontWeight: '700',
  },
  dropdownItemHint: {
    color: '#7c8798',
    fontSize: 11,
    marginTop: 3,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  searchCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  tagRow: {
    gap: 6,
    paddingVertical: 2,
  },
  tagButton: {
    borderWidth: 1,
    borderColor: '#d0d7e5',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  tagButtonSelected: {
    borderColor: '#e36b3d',
    backgroundColor: '#e36b3d',
  },
  tagButtonText: {
    color: '#465166',
    fontSize: 12,
  },
  tagButtonTextSelected: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  notionStatus: {
    color: '#f6d8b8',
    fontSize: 12,
    marginTop: 10,
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
  eventTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 8,
  },
  eventTag: {
    color: '#a44a25',
    backgroundColor: '#fff0e9',
    borderRadius: 12,
    paddingVertical: 3,
    paddingHorizontal: 8,
    fontSize: 11,
    fontWeight: '600',
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
