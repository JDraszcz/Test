import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  audioUrl?: string;
  transcription?: string;
  summary?: string;
  imageConcept?: string;
  recordingStatus?: 'planned' | 'recording' | 'transcribing' | 'ready';
  notes?: string;
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
const timeSlots = Array.from({ length: 36 }, (_, index) => {
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
  notes: '',
};

const eventsApiUrl =
  process.env.EXPO_PUBLIC_NOTES_API_URL ??
  (typeof window !== 'undefined' && window.location.hostname ? `http://${window.location.hostname}:8787/api/events` : 'http://localhost:8787/api/events');

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
  const [selectedEvent, setSelectedEvent] = useState<CourseEvent | null>(null);
  const [openTimePicker, setOpenTimePicker] = useState<'start' | 'end' | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [transcriptionStatus, setTranscriptionStatus] = useState('');
  const [isBackendAvailable, setIsBackendAvailable] = useState(true);
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');

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

  useEffect(() => {
    if (!selectedEvent) return;
    const currentEvent = events.find((event) => event.id === selectedEvent.id);
    if (currentEvent && currentEvent !== selectedEvent) setSelectedEvent(currentEvent);
  }, [events, selectedEvent]);

  useEffect(() => {
    fetch(eventsApiUrl)
      .then((response) => {
        if (!response.ok) throw new Error('Backend indisponible');
        return response.json() as Promise<{ events?: CourseEvent[] }>;
      })
      .then((payload) => setEvents(payload.events ?? []))
      .catch(() => setIsBackendAvailable(false));
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

  const createTranscript = (title: string) =>
    `Transcription de démonstration pour le cours de ${title}. Lancez le test micro ci-dessus pour vérifier la captation réelle.`;

  const createSummary = (title: string) =>
    `Synthèse : notions essentielles de ${title}, à convertir en fiche de révision.`;

  const createImageConcept = (title: string) =>
    `Image suggérée : schéma pédagogique pour ${title} (mind map + points clés du cours).`;

  const addTagToForm = (value: string) => {
    const tag = value.trim().replace(/,/g, '');
    if (!tag) return;
    const tags = form.tags.split(',').map((item) => item.trim()).filter(Boolean);
    if (!tags.includes(tag)) {
      setForm((previous) => ({ ...previous, tags: [...tags, tag].join(',') }));
    }
    setTagDraft('');
  };

  const removeTagFromForm = (tagToRemove: string) => {
    setForm((previous) => ({
      ...previous,
      tags: previous.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag && tag !== tagToRemove).join(','),
    }));
  };

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
      notes: form.notes,
    };

    setEvents((previous) => [...previous, nextEvent]);
    void fetch(eventsApiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(nextEvent) })
      .then((response) => { if (!response.ok) throw new Error('Création impossible'); })
      .catch(() => setIsBackendAvailable(false));
    setSavedCategories((previous) => [...new Set([...previous, ...tags])]);
    setForm(initialForm);
    setIsEventModalOpen(false);
    setFormError('');
    void startAudioCapture(nextEvent);
  };

  const updateEvent = async () => {
    if (!selectedEvent || !form.title.trim() || form.startTime >= form.endTime) {
      setFormError('Vérifiez le nom du cours et les horaires.');
      return;
    }
    const updated = {
      ...selectedEvent,
      day: form.day,
      subject: form.subject.trim() || 'Sans matière',
      title: form.title.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: form.notes,
    };
    setEvents((previous) => previous.map((event) => event.id === updated.id ? updated : event));
    try {
      const response = await fetch(`${eventsApiUrl}/${encodeURIComponent(updated.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      if (!response.ok) throw new Error('Modification impossible');
      setSelectedEvent(updated);
      setIsEditingEvent(false);
    } catch {
      setIsBackendAvailable(false);
      setFormError('Modification locale effectuée, mais synchronisation backend impossible.');
    }
  };

  const deleteEvent = async (event: CourseEvent) => {
    setEvents((previous) => previous.filter((item) => item.id !== event.id));
    setSelectedEvent(null);
    try {
      const response = await fetch(`${eventsApiUrl}/${encodeURIComponent(event.id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Suppression impossible');
    } catch {
      setIsBackendAvailable(false);
    }
  };

  const openEditEvent = (event: CourseEvent) => {
    setForm({
      day: event.day,
      subject: event.subject,
      title: event.title,
      startTime: event.startTime,
      endTime: event.endTime,
      tags: event.tags.join(','),
      notes: event.notes ?? '',
    });
    setNotesDraft(event.notes ?? '');
    setIsEditingEvent(true);
    setSelectedEvent(null);
    setIsEventModalOpen(true);
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
        setRecordingStatus('Enregistrement terminé. Ouvrez le détail pour lancer la transcription.');
        setEvents((previous) => previous.map((item) => item.id === event.id
          ? {
              ...item,
              recordingStatus: 'ready',
              audioFile: { filename: `cours-${event.id}.webm`, format: 'webm', estimatedSizeKb: Math.max(1, Math.round(chunks.reduce((total, chunk) => total + chunk.size, 0) / 1024)) },
              audioUrl: typeof URL !== 'undefined' ? URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' })) : undefined,
            }
          : item));
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

  const startTranscription = (event: CourseEvent) => {
    setTranscriptionStatus('Transcription en cours…');
    setTimeout(() => {
      setEvents((previous) => previous.map((item) => item.id === event.id
        ? { ...item, transcription: createTranscript(item.title), recordingStatus: 'ready' }
        : item));
      setSelectedEvent((previous) => previous?.id === event.id
        ? { ...event, transcription: createTranscript(event.title), recordingStatus: 'ready' }
        : previous);
      setTranscriptionStatus('Transcription terminée. (Mode démonstration : raccordez un moteur STT pour transcrire le fichier.)');
    }, 700);
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
          placeholderTextColor="#a7afc0"
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
              <Pressable key={event.id} style={styles.eventBubble} onPress={() => setSelectedEvent(event)}>
                <Text style={styles.eventBubbleTitle}>{event.title || event.subject}</Text>
                <Text style={styles.eventBubbleTime}>{event.startTime} · {event.endTime}</Text>
              </Pressable>
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
                <Text style={styles.sectionTitle}>{isEditingEvent ? 'Modifier le cours' : 'Nouveau cours'}</Text>
                <Text style={styles.cardSubtitle}>{isEditingEvent ? 'Mettez à jour les informations et vos notes' : 'Ajoutez un cours à votre agenda'}</Text>
              </View>
              <Pressable onPress={() => setIsEventModalOpen(false)}><Text style={styles.closeButton}>×</Text></Pressable>
            </View>
            <Text style={styles.label}>Jour</Text>
            <View style={styles.dayRow}>
              {weekDays.map((day) => <Pressable key={day} style={[styles.dayButton, form.day === day && styles.dayButtonSelected]} onPress={() => setForm((previous) => ({ ...previous, day }))}><Text style={form.day === day ? styles.dayButtonTextSelected : styles.dayButtonText}>{day}</Text></Pressable>)}
            </View>
            <Text style={styles.label}>Matière</Text>
            <TextInput style={styles.input} value={form.subject} onChangeText={(subject) => setForm((previous) => ({ ...previous, subject }))} placeholder="Ex. Mathématiques" placeholderTextColor="#a7afc0" />
            <Text style={styles.label}>Nom du cours</Text>
            <TextInput style={styles.input} value={form.title} onChangeText={(title) => setForm((previous) => ({ ...previous, title }))} placeholder="Ex. Fonctions" placeholderTextColor="#a7afc0" />
            <Text style={styles.label}>Catégories</Text>
            <View style={styles.tagEditor}>
              {form.tags.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                <Pressable key={tag} style={styles.tagPill} onPress={() => removeTagFromForm(tag)}>
                  <Text style={styles.tagPillText}>{tag} ×</Text>
                </Pressable>
              ))}
              <TextInput
                style={styles.tagInput}
                value={tagDraft}
                onChangeText={setTagDraft}
                onSubmitEditing={() => addTagToForm(tagDraft)}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Enter') addTagToForm(tagDraft);
                }}
                placeholder="Saisir un mot-clé puis Entrée"
                placeholderTextColor="#a7afc0"
              />
            </View>
            {savedCategories.filter((tag) => !form.tags.split(',').includes(tag)).length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
                {savedCategories.filter((tag) => !form.tags.split(',').includes(tag)).map((tag) => (
                  <Pressable key={tag} style={styles.tagSuggestion} onPress={() => addTagToForm(tag)}>
                    <Text style={styles.tagSuggestionText}>+ {tag}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Text style={styles.label}>Notes manuscrites</Text>
            <TextInput
              style={styles.handwrittenNotes}
              multiline
              value={form.notes}
              onChangeText={(notes) => setForm((previous) => ({ ...previous, notes }))}
              placeholder="Écrivez vos notes de cours ici…"
              placeholderTextColor="#a7afc0"
              textAlignVertical="top"
            />
            <View style={styles.timeRow}>
              {(['start', 'end'] as const).map((kind) => (
                <View key={kind} style={styles.timeField}>
                  <Text style={styles.label}>{kind === 'start' ? 'Début' : 'Fin'}</Text>
                  <Pressable style={styles.timeDropdown} onPress={() => setOpenTimePicker(openTimePicker === kind ? null : kind)}>
                    <Text style={styles.timeOptionText}>{kind === 'start' ? form.startTime : form.endTime}</Text>
                    <Text style={styles.dropdownChevron}>⌄</Text>
                  </Pressable>
                  {openTimePicker === kind && <ScrollView style={styles.timeMenu} nestedScrollEnabled>
                    {timeSlots.filter((time) => time !== (kind === 'start' ? form.startTime : form.endTime)).map((time) => (
                      <Pressable key={time} style={styles.timeOption} onPress={() => {
                        setForm((previous) => ({ ...previous, [kind === 'start' ? 'startTime' : 'endTime']: time }));
                        setOpenTimePicker(null);
                      }}>
                        <Text style={styles.timeOptionText}>{time}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>}
                </View>
              ))}
            </View>
            <View style={styles.switchRow}><Text style={styles.switchLabel}>Avoir une synthèse courte (en développement)</Text><Switch value={true} disabled /></View>
            <Pressable style={styles.primaryButton} onPress={isEditingEvent ? updateEvent : addEvent}><Text style={styles.primaryButtonText}>{isEditingEvent ? 'Enregistrer les modifications' : 'Démarrer la prise de notes audio'}</Text></Pressable>
            {!!formError && <Text style={styles.formError}>{formError}</Text>}
            <Text style={styles.modalHint}>La captation démarre dès la validation. Vous pouvez l’arrêter depuis la carte du cours ou elle s’arrêtera automatiquement à l’heure de fin.</Text>
          </View>
        </View>
      </Modal>
      <Modal visible={!!selectedEvent} transparent animationType="fade" onRequestClose={() => setSelectedEvent(null)}>
        <View style={styles.modalBackdrop}>
          {selectedEvent && <View style={styles.eventModal}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.sectionTitle}>{selectedEvent.title}</Text>
                <Text style={styles.cardSubtitle}>{selectedEvent.subject} · {selectedEvent.day} · {selectedEvent.startTime} - {selectedEvent.endTime}</Text>
              </View>
              <Pressable onPress={() => setSelectedEvent(null)}><Text style={styles.closeButton}>×</Text></Pressable>
            </View>
            <View style={styles.detailTagRow}>
              {selectedEvent.tags.map((tag) => <Text key={tag} style={styles.tagPillText}>{tag}</Text>)}
            </View>
            {selectedEvent.audioUrl ? (
              <View style={styles.audioPlayer}>
                {typeof document !== 'undefined'
                  ? React.createElement('audio', { controls: true, src: selectedEvent.audioUrl, style: { width: '100%' } })
                  : <Text style={styles.outputText}>Lecteur audio disponible dans la version web.</Text>}
              </View>
            ) : <Text style={styles.modalHint}>Aucun fichier audio enregistré pour ce cours.</Text>}
            {selectedEvent.audioUrl && <Pressable style={styles.primaryButton} onPress={() => startTranscription(selectedEvent)}>
              <Text style={styles.primaryButtonText}>Démarrer la transcription</Text>
            </Pressable>}
            {!!transcriptionStatus && <Text style={styles.recordingStatus}>{transcriptionStatus}</Text>}
            {!!selectedEvent.transcription && <View style={styles.detailSection}><Text style={styles.outputTitle}>Transcription</Text><Text style={styles.outputText}>{selectedEvent.transcription}</Text></View>}
            {!!selectedEvent.summary && <View style={styles.detailSection}><Text style={styles.outputTitle}>Synthèse</Text><Text style={styles.outputText}>{selectedEvent.summary}</Text></View>}
            {!!selectedEvent.notes && <View style={styles.handwrittenPreview}><Text style={styles.outputTitle}>Notes manuscrites</Text><Text style={styles.handwrittenText}>{selectedEvent.notes}</Text></View>}
            <View style={styles.detailActions}>
              <Pressable style={styles.secondaryButton} onPress={() => openEditEvent(selectedEvent)}><Text style={styles.secondaryButtonText}>Modifier</Text></Pressable>
              <Pressable style={styles.deleteButton} onPress={() => void deleteEvent(selectedEvent)}><Text style={styles.deleteButtonText}>Supprimer</Text></Pressable>
            </View>
            <Pressable style={[styles.recordButton, selectedEvent.recordingStatus === 'recording' && styles.recordButtonActive]} onPress={() => startNotesForEvent(selectedEvent)}>
              <Text style={styles.recordButtonText}>{selectedEvent.recordingStatus === 'recording' ? 'Arrêter la prise de notes' : 'Démarrer la prise de notes audio'}</Text>
            </Pressable>
            {!!recordingStatus && recordingEventIdRef.current === selectedEvent.id && <Text style={styles.recordingStatus}>{recordingStatus}</Text>}
          </View>}
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
  tagEditor: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    borderWidth: 1,
    borderColor: '#dce2ef',
    borderRadius: 12,
    padding: 7,
    marginBottom: 8,
  },
  tagPill: {
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: '#e7eaff',
  },
  tagPillText: {
    color: '#4356c7',
    fontSize: 12,
    fontWeight: '700',
  },
  tagInput: {
    flexGrow: 1,
    minWidth: 170,
    paddingVertical: 5,
    color: '#18223d',
  },
  tagSuggestion: {
    borderRadius: 14,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: '#f0f2f7',
  },
  tagSuggestionText: {
    color: '#69758f',
    fontSize: 12,
    fontWeight: '600',
  },
  timeDropdown: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#dce2ef',
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  timeMenu: {
    maxHeight: 130,
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#dce2ef',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  audioPlayer: {
    marginVertical: 14,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f5f7fb',
  },
  detailTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  detailSection: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f5f7fb',
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
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    marginBottom: 12,
  },
  deleteButton: {
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: '#ffe9e8',
  },
  deleteButtonText: {
    color: '#b42318',
    fontWeight: '800',
  },
  handwrittenNotes: {
    minHeight: 130,
    borderWidth: 1,
    borderColor: '#dce2ef',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    color: '#29366e',
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'cursive',
    backgroundColor: '#fffdf5',
  },
  handwrittenPreview: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fffdf5',
  },
  handwrittenText: {
    color: '#29366e',
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'cursive',
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
  eventBubble: {
    alignSelf: 'flex-start',
    minWidth: 180,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    backgroundColor: '#eef0ff',
    borderWidth: 1,
    borderColor: '#d7dcff',
  },
  eventBubbleTitle: {
    color: '#29366e',
    fontWeight: '800',
  },
  eventBubbleTime: {
    color: '#69758f',
    fontSize: 12,
    marginTop: 3,
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
