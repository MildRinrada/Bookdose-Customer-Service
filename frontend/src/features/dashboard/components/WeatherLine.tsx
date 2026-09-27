import { Icon } from '@/components/Icon';
import type { Weather } from '../types';

/* พยากรณ์อากาศของกล่องข้อความ (backend automation/weather.py): the line under the greeting, the day ahead in a weather
   report's words - ฟ้าใส, ฝนตกหนัก, บ่ายนี้มีพายุ, อากาศร้อน - and a figure or two behind it. The sky is one of the
   app's line icons on a soft tint of its meaning, the same on every screen (an emoji is drawn differently by every
   system). Markup: pages/team-spirit (dashboard-weather). */

const SKY: Record<Weather['kind'], string> = { storm: 'storm', rain: 'cloudRain', hot: 'thermometer', cloudy: 'cloud', clear: 'sun', fair: 'cloudSun' };

export function WeatherLine({ weather }: { weather?: Weather }) {
  if (!weather) return null;
  return (
    <p className={`dashboard-weather ${weather.kind}`}>
      <span className="weather-sky" aria-hidden="true">
        <Icon name={SKY[weather.kind]} />
      </span>
      <span className="weather-text">
        <strong>{weather.title}</strong>
        <span>{weather.detail}</span>
        {weather.notes.map((note) => (
          <span key={note} className="weather-note">
            {note}
          </span>
        ))}
      </span>
    </p>
  );
}
