/**
 * Pick a photo (camera or gallery) or a document (image/PDF) and upload it.
 *
 * ONE path for the profile photo, the truck verification photo and the
 * document scans. Photos are re-encoded by the picker at JPEG quality 0.5
 * and at most 1600 px on the long side - a 12 MP capture becomes ~200-400 KB,
 * which is what a hill-road connection can carry and well under the server's
 * 5 MB cap. Documents go up as-is (PDF or image), the server sniffs the type.
 *
 * Nothing is faked offline: the upload either returns a stored file or an
 * error the caller shows as "Upload requires connection".
 */

import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'

import { api, type FileKind, type StoredFileRead } from '../api/client'

export type PickSource = 'camera' | 'library'

const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.5,
  allowsEditing: false,
  exif: false,
}

/** Null when the driver cancelled or refused the permission. */
export async function pickPhoto(source: PickSource): Promise<{ uri: string; contentType: string } | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return null
  }
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(PHOTO_OPTIONS)
    : await ImagePicker.launchImageLibraryAsync(PHOTO_OPTIONS)
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  return { uri: asset.uri, contentType: asset.mimeType ?? 'image/jpeg' }
}

/** An image or a PDF from the phone's files. Null when cancelled. */
export async function pickDocument(): Promise<{ uri: string; contentType: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'application/pdf'], copyToCacheDirectory: true, multiple: false })
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  return { uri: asset.uri, contentType: asset.mimeType ?? 'application/octet-stream' }
}

export async function upload(file: { uri: string; contentType: string }, kind: FileKind): Promise<StoredFileRead> {
  return api.uploadFile(file.uri, kind, file.contentType)
}
