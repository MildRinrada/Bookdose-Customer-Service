'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { openPhotoFile, PhotoCropper } from '@/features/rich/PhotoCropper';
import { Avatar, ProfilePhoto } from './display';
import { useDialogs } from './Dialogs';
import { useToast } from './Toast';

/* The profile picture in the account dialog (ported from old-frontend/ui/photo.js): the picture is the button, with a
   camera badge; choosing a file opens the cropper in the sheet (drag to move, slide to zoom) and the finished square
   goes into a hidden "avatar" field as a data: URL ('' removes the picture). Nothing is uploaded until the form
   around it is saved. `title` names what the picture is of, so an organization's logo reads as its own thing rather
   than as somebody's profile picture. */

export function PhotoPicker({
  name = 'avatar',
  value,
  personName,
  title = 'รูปโปรไฟล์',
  hint = 'คลิกที่รูปเพื่อเลือกภาพใหม่ แล้วเลื่อนและย่อ-ขยายให้พอดีวงกลม · PNG หรือ JPG ไม่เกิน 5 MB',
}: {
  name?: string;
  value: string;
  personName: string;
  title?: string;
  hint?: string;
}) {
  const [photo, setPhoto] = useState(value);
  const fileRef = useRef<HTMLInputElement>(null);
  const { openSheet, closeSheet } = useDialogs();
  const toast = useToast();
  const pick = () => fileRef.current?.click();

  return (
    <div className="photo-picker">
      <button type="button" className="photo-button" onClick={pick} aria-label={`เปลี่ยน${title}`} title={`คลิกเพื่อเปลี่ยน${title}`}>
        <span className="photo-frame" data-photo-preview="">
          {photo ? <ProfilePhoto src={photo} alt={title} /> : <Avatar name={personName} index={2} />}
        </span>
        <span className="photo-camera" aria-hidden="true">
          <Icon name="camera" />
        </span>
      </button>
      <div className="photo-side">
        <strong>{title}</strong>
        <p className="photo-hint muted">{hint}</p>
        <div className="photo-actions">
          <button type="button" className="btn sm" onClick={pick}>
            <Icon name="image" />
            เลือกรูปใหม่
          </button>
          <button
            type="button"
            className="btn sm subtle"
            hidden={!photo}
            onClick={() => {
              setPhoto('');
              toast('รูปจะถูกลบเมื่อกดบันทึก');
            }}
          >
            <Icon name="close" />
            ลบรูป
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        id="photo-file"
        accept="image/png,image/jpeg"
        tabIndex={-1}
        aria-hidden="true"
        data-photo-input="1"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          input.value = '';
          if (!file) return;
          openPhotoFile(file)
            .then((bitmap) =>
              openSheet(
                'ปรับรูปโปรไฟล์',
                <PhotoCropper
                  bitmap={bitmap}
                  onCancel={closeSheet}
                  onApply={(url) => {
                    setPhoto(url);
                    closeSheet();
                    toast('ปรับรูปแล้ว · กดบันทึกเพื่อใช้รูปนี้');
                  }}
                />,
              ),
            )
            .catch((error: Error) => toast(error.message, true));
        }}
      />
      <input type="hidden" name={name} value={photo} />
    </div>
  );
}
