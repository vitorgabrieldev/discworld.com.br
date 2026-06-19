import styles from "./page.module.css";

export default function HomePage() {
  const loginUrl = `${process.env.NEXT_PUBLIC_SERVER_URL}/auth/login`;

  return (
    <main className={styles.main}>
      <div className={styles.hero}>
        <div className={styles.badge}>Beta</div>
        <h1 className={styles.title}>
          Seu servidor Discord<br />virou um mundo 2D
        </h1>
        <p className={styles.subtitle}>
          Conecte seu servidor e explore cada canal como uma sala. Chega perto de alguém e começa a ouvir — spatial audio nativo. Sem configuração.
        </p>
        <a href={loginUrl} className={styles.loginBtn}>
          <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
          </svg>
          Entrar com Discord
        </a>
        <p className={styles.note}>Gratuito até 20 usuários simultâneos</p>
      </div>

      <div className={styles.features}>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>🗺️</span>
          <h3>Mapa automático</h3>
          <p>Cada categoria vira um bioma, cada canal uma sala. Zero configuração.</p>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>🔊</span>
          <h3>Spatial audio</h3>
          <p>Quanto mais perto de alguém, mais alto você ouve. Como na vida real.</p>
        </div>
        <div className={styles.feature}>
          <span className={styles.featureIcon}>🛡️</span>
          <h3>Permissões Discord</h3>
          <p>Seus cargos do servidor definem quais salas você pode entrar.</p>
        </div>
      </div>
    </main>
  );
}
