/**
 * Every support.jamf.com article in de, es and fr, 15 each, with the title
 * Intercom's collection pages give it, captured 2026-09-28.
 *
 * The site writes these three languages in Latin letters and its slugs drop
 * their accents (`verknüpft` is `verknupft`). A title made from one of these
 * slugs is what the search index shows for the article only when its
 * collection page cannot be read (static-titles.ts), and these are what such
 * a title is checked against.
 */
export interface SupportLatinTitle {
  /** Path as the sitemap lists it, e.g. `/de/articles/…`. */
  listed: string;
  /** The title Intercom's collection page gives the article. */
  title: string;
}

export const SUPPORT_LATIN_TITLES: readonly SupportLatinTitle[] = [
  {
    listed: '/de/articles/10631329-self-service-muss-mit-dem-jamf-server-verknupft-sein',
    title: 'Self Service muss mit dem Jamf-Server verknüpft sein',
  },
  {
    listed: '/de/articles/11016585-ermitteln-des-apple-kontos-das-fur-die-erstellung-des-push-zertifikats-verwendet-wurde',
    title: 'Ermitteln des Apple-Kontos, das für die Erstellung des Push-Zertifikats verwendet wurde',
  },
  {
    listed: '/de/articles/11016634-erneuern-sie-ihr-mdm-push-benachrichtigungszertifikat-in-jamf-pro',
    title: 'Erneuern Sie Ihr MDM-Push-Benachrichtigungszertifikat in Jamf Pro',
  },
  {
    listed: '/de/articles/11016567-ausser-dienst-stellen-oder-aktualisieren-von-jamf-pro-verwalteten-geraten',
    title: 'Außer Dienst stellen oder Aktualisieren von Jamf Pro verwalteten Geräten',
  },
  {
    listed: '/de/articles/11156455-andern-sie-das-passwort-ihres-jamf-pro-benutzerkontos',
    title: 'Ändern Sie das Passwort Ihres Jamf Pro-Benutzerkontos',
  },
  {
    listed: '/de/articles/11030100-unterstutzung-durch-ihr-jamf-kontoteam-erhalten',
    title: 'Unterstützung durch Ihr Jamf-Kontoteam erhalten',
  },
  {
    listed: '/de/articles/11681388-arbeiten-mit-dem-jamf-support-im-jamf-account',
    title: 'Arbeiten mit dem Jamf Support im Jamf Account',
  },
  {
    listed: '/de/articles/11657440-anmeldung-bei-jamf-account-wenn-ihre-identity-provider-zugangsdaten-nicht-funktionieren',
    title: 'Anmeldung bei Jamf Account, wenn Ihre Identity-Provider-Zugangsdaten nicht funktionieren',
  },
  {
    listed: '/de/articles/11014479-associeren-sie-ihre-jamf-id-mit-ihrer-organisation-in-jamf-account',
    title: 'Associeren Sie Ihre Jamf ID mit Ihrer Organisation in Jamf Account',
  },
  { listed: '/de/articles/11155937-jamf-id-erstellen', title: 'Jamf ID erstellen' },
  { listed: '/de/articles/11156264-andern-ihres-jamf-id-passworts', title: 'Ändern Ihres Jamf ID-Passworts' },
  {
    listed: '/de/articles/11645274-wenn-sie-sich-nicht-mit-ihrer-jamf-id-bei-jamf-account-anmelden-konnen',
    title: 'Wenn Sie sich nicht mit Ihrer Jamf ID bei Jamf Account anmelden können',
  },
  { listed: '/de/articles/11647778-jamf-id-mfa-funktioniert-nicht', title: 'Jamf ID MFA funktioniert nicht' },
  {
    listed: '/de/articles/11657549-jamf-auth-es-tut-uns-leid-ein-fehler-ist-beim-anmelden-bei-jamf-account-aufgetreten',
    title: 'jamf-auth: Es tut uns leid, ein Fehler ist beim Anmelden bei Jamf Account aufgetreten',
  },
  {
    listed: '/de/articles/11003438-jamf-connect-lizenz-nach-der-verlangerung-aktualisieren',
    title: 'Jamf Connect-Lizenz nach der Verlängerung aktualisieren',
  },
  {
    listed: '/es/articles/10631329-self-service-debe-estar-asociado-con-el-servidor-de-jamf',
    title: 'Self Service debe estar asociado con el servidor de Jamf',
  },
  {
    listed: '/es/articles/11016585-encontrar-la-cuenta-de-apple-utilizada-para-la-creacion-del-certificado-push',
    title: 'Encontrar la cuenta de Apple utilizada para la creación del certificado Push',
  },
  {
    listed: '/es/articles/11016634-renueve-su-certificado-de-notificaciones-push-mdm-en-jamf-pro',
    title: 'Renueve su Certificado de Notificaciones Push MDM en Jamf Pro',
  },
  {
    listed: '/es/articles/11016567-retiro-o-renovacion-de-dispositivos-gestionados-con-jamf-pro',
    title: 'Retiro o renovación de dispositivos gestionados con Jamf Pro',
  },
  {
    listed: '/es/articles/11156455-cambie-la-contrasena-de-su-cuenta-de-usuario-de-jamf-pro',
    title: 'Cambie la contraseña de su cuenta de usuario de Jamf Pro',
  },
  {
    listed: '/es/articles/11030100-obtener-ayuda-de-su-equipo-de-gestion-de-cuenta',
    title: 'Obtener ayuda de su equipo de gestión de cuenta',
  },
  {
    listed: '/es/articles/11681388-contactar-con-soporte-de-jamf-desde-jamf-account',
    title: 'Contactar con Soporte de Jamf desde Jamf Account',
  },
  {
    listed: '/es/articles/11657440-iniciar-sesion-en-jamf-account-si-las-credenciales-del-proveedor-de-identidad-no-funcionan',
    title: 'Iniciar sesión en Jamf Account si las credenciales del proveedor de identidad no funcionan',
  },
  {
    listed: '/es/articles/11014479-asocie-su-jamf-id-con-su-organizacion-en-jamf-account',
    title: 'Asocie su Jamf ID con su organización en Jamf Account',
  },
  { listed: '/es/articles/11155937-crear-un-id-de-jamf', title: 'Crear un ID de Jamf' },
  {
    listed: '/es/articles/11156264-cambiar-la-contrasena-de-su-id-de-jamf',
    title: 'Cambiar la contraseña de su ID de Jamf',
  },
  {
    listed: '/es/articles/11645274-no-puede-iniciar-sesion-en-jamf-account-con-su-id-de-jamf',
    title: '¿No puede iniciar sesión en Jamf Account con su ID de Jamf?',
  },
  {
    listed: '/es/articles/11647778-la-autenticacion-multifactor-mfa-del-id-de-jamf-no-funciona',
    title: 'La autenticación multifactor (MFA) del ID de Jamf no funciona',
  },
  {
    listed: '/es/articles/11657549-mensaje-jamf-auth-lo-sentimos-ocurrio-un-error-al-iniciar-sesion-en-jamf-account',
    title: 'Mensaje "jamf-auth Lo sentimos, ocurrió un error" al iniciar sesión en Jamf Account',
  },
  {
    listed: '/es/articles/11003438-actualizar-la-licencia-de-jamf-connect-despues-de-la-renovacion',
    title: 'Actualizar la licencia de Jamf Connect después de la renovación',
  },
  {
    listed: '/fr/articles/10631329-self-service-doit-etre-associe-au-serveur-jamf',
    title: 'Self Service doit être associé au serveur Jamf',
  },
  {
    listed: '/fr/articles/11016585-trouver-le-compte-apple-utilise-pour-la-creation-du-certificat-push',
    title: 'Trouver le compte Apple utilisé pour la création du certificat Push',
  },
  {
    listed: '/fr/articles/11016634-renouvelez-votre-certificat-de-notification-push-mdm-dans-jamf-pro',
    title: 'Renouvelez votre certificat de notification push MDM dans Jamf Pro',
  },
  {
    listed: '/fr/articles/11016567-retrait-ou-renouvellement-des-appareils-geres-par-jamf-pro',
    title: 'Retrait ou renouvellement des appareils gérés par Jamf Pro',
  },
  {
    listed: '/fr/articles/11156455-changez-le-mot-de-passe-de-votre-compte-utilisateur-jamf-pro',
    title: 'Changez le mot de passe de votre compte utilisateur Jamf Pro',
  },
  {
    listed: '/fr/articles/11030100-obtenir-de-l-aide-aupres-de-votre-equipe-de-compte-chez-jamf',
    title: 'Obtenir de l’aide auprès de votre équipe de compte chez Jamf',
  },
  {
    listed: '/fr/articles/11681388-travailler-avec-le-support-jamf-dans-jamf-account',
    title: 'Travailler avec le support Jamf dans Jamf Account',
  },
  {
    listed: '/fr/articles/11657440-connexion-a-jamf-account-si-vos-identifiants-du-fournisseur-d-identite-ne-fonctionnent-pas',
    title: 'Connexion à Jamf Account si vos identifiants du fournisseur d’identité ne fonctionnent pas',
  },
  {
    listed: '/fr/articles/11014479-associez-votre-jamf-id-a-votre-organisation-dans-jamf-account',
    title: 'Associez votre Jamf ID à votre organisation dans Jamf Account',
  },
  { listed: '/fr/articles/11155937-creer-un-identifiant-jamf', title: 'Créer un identifiant Jamf' },
  {
    listed: '/fr/articles/11156264-modifier-votre-mot-de-passe-d-identifiant-jamf',
    title: 'Modifier votre mot de passe d’identifiant Jamf',
  },
  {
    listed: '/fr/articles/11645274-vous-ne-pouvez-pas-vous-connecter-a-jamf-account-avec-votre-identifiant-jamf',
    title: 'Vous ne pouvez pas vous connecter à Jamf Account avec votre identifiant Jamf?',
  },
  {
    listed: '/fr/articles/11647778-l-authentification-multifacteur-mfa-de-l-identifiant-jamf-jamf-id-ne-fonctionne-pas',
    title: 'L’authentification multifacteur (MFA) de l’identifiant Jamf (Jamf ID) ne fonctionne pas',
  },
  {
    listed: '/fr/articles/11657549-message-jamf-auth-nous-sommes-desoles-une-erreur-est-survenue-lors-de-la-connexion-a-jamf-account',
    title: 'Message « jamf-auth : Nous sommes désolés, une erreur est survenue » lors de la connexion à Jamf Account',
  },
  {
    listed: '/fr/articles/11003438-mettre-a-jour-la-licence-jamf-connect-apres-le-renouvellement',
    title: 'Mettre à jour la licence Jamf Connect après le renouvellement',
  },
];
