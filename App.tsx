import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { exportEventsToNotion, getNotionAuthorizationUrl, getNotionConfiguration, getNotionSession } from './notion';
import {
  Pressable,
  ScrollView,
  Modal,
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
  audioFile?: {
    filename: string;
    format: 'm4a' | 'webm';
    estimatedSizeKb: number;
  };
  transcription?: string;
  summary?: string;
  imageConcept?: string;
  recordingStatus?: 'planned' | 'recording' | 'transcribing' | 'ready';
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
const timeSlots = Array.from({ length: 29 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

const initialForm = {
  day: 'Lundi' as WeekDay,
  subject: '',
  title: '',
  startTime: '08:00',
  endTime: '09:00',
  tags: '',
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type MediaRecorderLike = {
  start: () => void;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
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
  const [isOldPlanningOpen, setIsOldPlanningOpen] = useState(false);
  const [isOldCoursesOpen, setIsOldCoursesOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micTranscript, setMicTranscript] = useState('');
  const [micStatus, setMicStatus] = useState('Prêt à vérifier votre microphone.');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [savedCategories, setSavedCategories] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState('');
  const mediaRecorderRef = useRef<MediaRecorderLike | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingEventIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('cours-categories');
    if (stored) setSavedCategories(JSON.parse(stored) as string[]);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('cours-categories', JSON.stringify(savedCategories));
    }
  }, [savedCategories]);

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

  const createTranscript = (title: string) =>
    `Transcription de démonstration pour le cours de ${title}. Lancez le test micro ci-dessus pour vérifier la captation réelle.`;

  const createSummary = (title: string) =>
    `Synthèse : notions essentielles de ${title}, à convertir en fiche de révision.`;

  const createImageConcept = (title: string) =>
    `Image suggérée : schéma pédagogique pour ${title} (mind map + points clés du cours).`;

  const addEvent = () => {
    if (!form.title.trim()) {
      setFormError('Indiquez le nom du cours avant de l’ajouter.');
      return;
    }

    if (form.startTime >= form.endTime) {
      setFormError('L’heure de fin doit être postérieure à l’heure de début.');
      return;
    }

    setFormError('');
    const eventId = `${Date.now()}`;
    const tags = form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .filter((tag, index, values) => values.indexOf(tag) === index);

    const nextEvent: CourseEvent = {
      id: eventId,
      weekKey: selectedWeekKey,
      day: form.day,
      subject: form.subject.trim() || 'Sans matière',
      title: form.title.trim(),
      startTime: form.startTime,
      endTime: form.endTime.trim(),
      tags,
      audioEnabled: true,
      recordingStatus: 'planned',
    };

    setEvents((previous) => [...previous, nextEvent]);
    setSavedCategories((previous) => [...new Set([...previous, ...tags])]);
    setForm(initialForm);
    setIsEventModalOpen(false);
    setFormError('');
    void startAudioCapture(nextEvent);
  };

  const startAudioCapture = async (event: CourseEvent) => {
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingStatus('L’enregistrement continu nécessite un navigateur compatible ou l’application native.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new window.MediaRecorder(stream) as unknown as MediaRecorderLike;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (dataEvent) => chunks.push(dataEvent.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setRecordingStatus('Enregistrement terminé. Retranscription en cours…');
        setEvents((previous) => previous.map((item) => item.id === event.id
          ? {
              ...item,
              recordingStatus: 'transcribing',
              audioFile: { filename: `cours-${event.id}.webm`, format: 'webm', estimatedSizeKb: Math.max(1, Math.round(chunks.reduce((total, chunk) => total + chunk.size, 0) / 1024)) },
              transcription: createTranscript(event.title),
              summary: createSummary(event.title),
              imageConcept: createImageConcept(event.title),
            }
          : item));
        setTimeout(() => {
          setEvents((previous) => previous.map((item) => item.id === event.id ? { ...item, recordingStatus: 'ready' } : item));
          setRecordingStatus('Retranscription terminée.');
        }, 700);
      };
      mediaRecorderRef.current = recorder;
      recordingStreamRef.current = stream;
      recordingEventIdRef.current = event.id;
      recorder.start();
      setIsRecording(true);
      setRecordingStatus(`Prise de notes en cours pour « ${event.title} ».`);
      setEvents((previous) => previous.map((item) => item.id === event.id ? { ...item, recordingStatus: 'recording' } : item));
      const [hours, minutes] = event.endTime.split(':').map(Number);
      const end = new Date();
      end.setHours(hours, minutes, 0, 0);
      if (end.getTime() <= Date.now()) end.setDate(end.getDate() + 1);
      recordingTimerRef.current = setTimeout(stopAudioCapture, end.getTime() - Date.now());
    } catch {
      setRecordingStatus('Accès au microphone refusé ou indisponible.');
    }
  };

  const stopAudioCapture = () => {
    if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current);
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    recordingStreamRef.current = null;
  };

  const startNotesForEvent = (event: CourseEvent) => {
    if (isRecording) {
      stopAudioCapture();
      return;
    }
    void startAudioCapture(event);
  };

  const toggleMicTest = async () => {
    if (isMicTesting) {
      recognitionRef.current?.stop();
      setIsMicTesting(false);
      setMicStatus('Test arrêté.');
      return;
    }

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicStatus('Le test micro nécessite un navigateur avec accès audio sécurisé (HTTPS ou localhost).');
      return;
    }

    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMicStatus('La retranscription vocale n’est pas disponible dans ce navigateur.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const recognition = new Recognition();
      recognition.lang = 'fr-FR';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.onresult = (event) => {
        const text = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? '')
          .join(' ');
        setMicTranscript(text);
      };
      recognition.onerror = (event) => {
        setIsMicTesting(false);
        setMicStatus(`Erreur de retranscription : ${event.error}.`);
      };
      recognition.onend = () => setIsMicTesting(false);
      recognitionRef.current = recognition;
      setMicTranscript('');
      setMicStatus('Micro actif. Parlez pour voir la retranscription en direct.');
      setIsMicTesting(true);
      recognition.start();
    } catch {
      setMicStatus('Accès au microphone refusé ou indisponible. Vérifiez les permissions du navigateur.');
    }
  };

  const connectToNotion = async () => {
    const authorizationUrl = getNotionAuthorizationUrl();
    try {
      const configured = await getNotionConfiguration();
      if (!configured) {
        setNotionStatus('Notion n’est pas configuré. Renseignez les identifiants dans le fichier .env du backend.');
        return;
      }

      if (typeof window !== 'undefined') {
        window.location.assign(authorizationUrl);
        return;
      }

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
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>ESPACE D’ÉTUDE</Text>
          <Text style={styles.heading}>Votre semaine, en un coup d’œil.</Text>
          <Text style={styles.heroSubtitle}>Planifiez vos cours, capturez les idées importantes et retrouvez tout au même endroit.</Text>
        </View>
        <View style={styles.heroOrb}><Text style={styles.heroOrbText}>✦</Text></View>
      </View>

      <View style={styles.micCard}>
        <View style={styles.micCardHeader}>
          <View>
            <Text style={styles.sectionTitle}>Vérifier le micro</Text>
            <Text style={styles.cardSubtitle}>Test réel de captation et de retranscription</Text>
          </View>
          <View style={[styles.statusDot, isMicTesting && styles.statusDotActive]} />
        </View>
        <Text style={styles.micStatus}>{micStatus}</Text>
        {!!micTranscript && <Text style={styles.liveTranscript}>{micTranscript}</Text>}
        <Pressable style={[styles.secondaryButton, isMicTesting && styles.stopButton]} onPress={toggleMicTest}>
          <Text style={styles.secondaryButtonText}>{isMicTesting ? 'Arrêter le test' : 'Démarrer le test micro'}</Text>
        </Pressable>
      </View>

      <View style={styles.historyMenu}>
        <Pressable style={styles.historyMenuButton} onPress={() => setIsOldPlanningOpen((previous) => !previous)}>
          <Text style={styles.historyMenuButtonText}>Anciens plannings</Text>
          <Text style={styles.historyMenuButtonChevron}>{isOldPlanningOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {isOldPlanningOpen && weekOptions.slice(1).map((week) => (
          <Pressable
            key={week.key}
            style={[styles.historyMenuItem, week.key === selectedWeekKey && styles.historyMenuItemSelected]}
            onPress={() => setSelectedWeekKey(week.key)}
          >
            <Text style={week.key === selectedWeekKey ? styles.historyMenuItemTextSelected : styles.historyMenuItemText}>
              {week.label}
            </Text>
            <Text style={styles.historyMenuItemHint}>Planning archivé</Text>
          </Pressable>
        ))}
        <Pressable style={styles.historyMenuButton} onPress={() => setIsOldCoursesOpen((previous) => !previous)}>
          <Text style={styles.historyMenuButtonText}>Anciens cours et catégories</Text>
          <Text style={styles.historyMenuButtonChevron}>{isOldCoursesOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {isOldCoursesOpen && availableSubjects.map((subject) => (
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
        <View style={styles.integrationItem}>
          <Text style={styles.integrationTitle}>Pronote</Text>
          <Text style={styles.integrationText}>Import automatique de l’agenda bientôt disponible.</Text>
        </View>
        {!!notionStatus && <Text style={styles.notionStatus}>{notionStatus}</Text>}
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

                {event.audioEnabled ? (
                  <View style={styles.outputBlock}>
                    <Pressable
                      style={[styles.recordButton, event.recordingStatus === 'recording' && styles.recordButtonActive]}
                      onPress={() => startNotesForEvent(event)}
                    >
                      <Text style={styles.recordButtonText}>
                        {event.recordingStatus === 'recording' ? 'Arrêter la prise de notes' : 'Démarrer la prise de notes audio'}
                      </Text>
                    </Pressable>
                    {!!recordingStatus && recordingEventIdRef.current === event.id && (
                      <Text style={styles.recordingStatus}>{recordingStatus}</Text>
                    )}
                    {event.audioFile && (
                    <>
                    <Text style={styles.outputTitle}>Audio</Text>
                    <Text style={styles.outputText}>
                      {event.audioFile.filename} ({event.audioFile.format.toUpperCase()}) • ~{event.audioFile.estimatedSizeKb} KB
                    </Text>
                    <Text style={styles.outputText}>
                      Captation audio activée
                    </Text>

                    <Text style={styles.outputTitle}>Transcription</Text>
                    <Text style={styles.outputText}>{event.transcription}</Text>

                    <Text style={styles.outputTitle}>Synthèse</Text>
                    <Text style={styles.outputText}>{event.summary}</Text>

                    <Text style={styles.outputTitle}>Création d'image</Text>
                    <Text style={styles.outputText}>{event.imageConcept}</Text>
                    </>
                    )}
                  </View>
                ) : (
                  <Text style={styles.outputText}>Pas d'enregistrement demandé.</Text>
                )}
              </View>
            ))
          )}
        </View>
      ))}
      <Pressable style={styles.fab} onPress={() => setIsEventModalOpen(true)} accessibilityLabel="Ajouter un cours">
        <Text style={styles.fabText}>+</Text>
      </Pressable>
      <Modal visible={isEventModalOpen} transparent animationType="slide" onRequestClose={() => setIsEventModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.eventModal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.sectionTitle}>Nouveau cours</Text>
                <Text style={styles.cardSubtitle}>Ajoutez un cours à votre agenda</Text>
              </View>
              <Pressable onPress={() => setIsEventModalOpen(false)}><Text style={styles.closeButton}>×</Text></Pressable>
            </View>
            <Text style={styles.label}>Jour</Text>
            <View style={styles.dayRow}>
              {weekDays.map((day) => <Pressable key={day} style={[styles.dayButton, form.day === day && styles.dayButtonSelected]} onPress={() => setForm((previous) => ({ ...previous, day }))}><Text style={form.day === day ? styles.dayButtonTextSelected : styles.dayButtonText}>{day}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Matière</Text>
            <TextInput style={styles.input} value={form.subject} onChangeText={(subject) => setForm((previous) => ({ ...previous, subject }))} placeholder="Ex. Mathématiques" />
            <Text style={styles.label}>Nom du cours</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(title) => setForm((previous) => ({ ...previous, title }))} placeholder="Ex. Fonctions" />
            <Text style={styles.label}>Catégories</Text>
            <TextInput style={styles.input} value={form.tags} onChangeText={(tags) => setForm((previous) => ({ ...previous, tags }))} placeholder="Ex. examen, sciences" />
            {savedCategories.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>{savedCategories.map((tag) => <Pressable key={tag} style={styles.tagButton} onPress={() => setForm((previous) => ({ ...previous, tags: previous.tags ? `${previous.tags}, ${tag}` : tag }))}><Text style={styles.tagButtonText}>{tag}</Text></Pressable>)}</ScrollView>}
            <View style={styles.timeRow}>
              <View style={styles.timeField}><Text style={styles.label}>Début</Text><ScrollView style={styles.timePicker} nestedScrollEnabled>{timeSlots.map((time) => <Pressable key={`start-${time}`} style={[styles.timeOption, form.startTime === time && styles.timeOptionSelected]} onPress={() => setForm((previous) => ({ ...previous, startTime: time }))}><Text style={styles.timeOptionText}>{time}</Text></Pressable>)}</ScrollView></View>
              <View style={styles.timeField}><Text style={styles.label}>Fin</Text><ScrollView style={styles.timePicker} nestedScrollEnabled>{timeSlots.map((time) => <Pressable key={`end-${time}`} style={[styles.timeOption, form.endTime === time && styles.timeOptionSelected]} onPress={() => setForm((previous) => ({ ...previous, endTime: time }))}><Text style={styles.timeOptionText}>{time}</Text></Pressable>)}</ScrollView></View>
            </View>
            <View style={styles.switchRow}><Text style={styles.switchLabel}>Avoir une synthèse courte (en développement)</Text><Switch value={true} disabled /></View>
            <Pressable style={styles.primaryButton} onPress={addEvent}><Text style={styles.primaryButtonText}>Démarrer la prise de notes audio</Text></Pressable>
            {!!formError && <Text style={styles.formError}>{formError}</Text>}
            <Text style={styles.modalHint}>La captation démarre dès la validation. Vous pouvez l’arrêter depuis la carte du cours ou elle s’arrêtera automatiquement à l’heure de fin.</Text>
          </View>
        </View>
      </Modal>
      <StatusBar style="auto" />

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    paddingBottom: 48,
    backgroundColor: '#f5f7fb',
    maxWidth: 980,
    alignSelf: 'center',
    width: '100%',
  },
  hero: {
    minHeight: 190,
    borderRadius: 28,
    padding: 24,
    marginBottom: 16,
    backgroundColor: '#18223d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  heroCopy: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    color: '#9caefb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 12,
  },
  heroSubtitle: {
    color: '#c7d0e8',
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 560,
  },
  heroOrb: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#6d7ffc',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.95,
  },
  heroOrbText: {
    color: '#fff',
    fontSize: 44,
  },
  heading: {
    color: '#fff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginBottom: 10,
  },
  micCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e4e8f2',
  },
  micCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardSubtitle: {
    color: '#69758f',
    fontSize: 13,
    marginTop: -5,
    marginBottom: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#c5ccda',
    marginTop: 5,
  },
  statusDotActive: {
    backgroundColor: '#25b77a',
  },
  micStatus: {
    color: '#465166',
    fontSize: 13,
    marginBottom: 10,
  },
  liveTranscript: {
    color: '#18223d',
    backgroundColor: '#f0f3ff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    fontSize: 15,
    lineHeight: 22,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: '#edf0ff',
  },
  stopButton: {
    backgroundColor: '#ffe9e8',
  },
  secondaryButtonText: {
    color: '#4356c7',
    fontWeight: '800',
  },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#5367e8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#18223d',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    zIndex: 10,
  },
  fabText: {
    color: '#fff',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '300',
  },
  eventModal: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '92%',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  closeButton: {
    color: '#68748e',
    fontSize: 30,
    lineHeight: 30,
    paddingHorizontal: 6,
  },
  modalHint: {
    color: '#7c8798',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  timePicker: {
    maxHeight: 108,
    borderWidth: 1,
    borderColor: '#dce2ef',
    borderRadius: 12,
  },
  timeOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0f6',
  },
  timeOptionSelected: {
    backgroundColor: '#edf0ff',
  },
  timeOptionText: {
    color: '#465166',
    textAlign: 'center',
    fontWeight: '600',
  },
  recordButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#5367e8',
    marginBottom: 8,
  },
  recordButtonActive: {
    backgroundColor: '#d94f5c',
  },
  recordButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  recordingStatus: {
    color: '#5367e8',
    fontSize: 12,
    marginBottom: 8,
  },
  historyMenu: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e4e8f2',
  },
  historyMenuButton: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf0f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyMenuButtonText: {
    color: '#1e2a3b',
    fontWeight: '700',
  },
  historyMenuButtonChevron: {
    color: '#2246d2',
    fontSize: 12,
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
  formError: {
    color: '#b42318',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
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
  integrationItem: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f5f7fb',
  },
  integrationTitle: {
    color: '#18223d',
    fontWeight: '800',
    marginBottom: 3,
  },
  integrationText: {
    color: '#69758f',
    fontSize: 12,
    lineHeight: 18,
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
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e4e8f2',
  },
  searchCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e4e8f2',
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
    color: '#18223d',
    fontSize: 19,
    fontWeight: '800',
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
    borderColor: '#dce2ef',
    borderRadius: 12,
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
    backgroundColor: '#5367e8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  dayCard: {
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e4e8f2',
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
    backgroundColor: '#f4f6ff',
    borderRadius: 14,
    padding: 12,
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
